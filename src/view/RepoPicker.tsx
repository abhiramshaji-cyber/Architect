import { useEffect, useMemo, useRef, useState } from 'react'
import { openProject, useProject } from '../model/store'
import {
  authNote,
  entered,
  escaped,
  gitMessage,
  githubMessage,
  moved,
  openMessage,
  rank,
  riskText,
  START,
  typed,
  type PickerState,
} from '../model/picker'
import type {
  GithubAuth,
  GithubBranch,
  GithubPull,
  GithubRepo,
  OpenChoice,
  OpenPlan,
} from '../../shared/types'

type Row = { key: string; label: string; branch: string; pr?: number }

const REPO_CACHE = 'github:repos'
const BRANCH_CACHE = 'github:branches:'

function cached<T>(key: string): T[] {
  try {
    const stored = localStorage.getItem(key)
    const rows: unknown = stored ? JSON.parse(stored) : null
    return Array.isArray(rows) ? (rows as T[]) : []
  } catch {
    return []
  }
}

function cache(key: string, rows: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(rows))
  } catch {}
}

function basename(target: string): string {
  return target.split('/').filter(Boolean).pop() ?? target
}

function openedAs(roots: string[], repo: GithubRepo): string | null {
  const names = [repo.name, `${repo.owner}-${repo.name}`]
  return roots.find((root) => names.some((name) => basename(root) === name || basename(root).startsWith(`${name}-`))) ?? null
}

function pushedText(pushedAt: string | null): string {
  if (!pushedAt) return 'never pushed'
  const at = Date.parse(pushedAt)
  if (Number.isNaN(at)) return 'never pushed'

  const days = Math.floor((Date.now() - at) / 86_400_000)
  if (days <= 0) return 'pushed today'
  if (days === 1) return 'pushed yesterday'
  if (days < 30) return `pushed ${days} days ago`

  return `pushed ${new Date(at).toLocaleDateString()}`
}

function rowsOf(branches: GithubBranch[], pulls: GithubPull[]): Row[] {
  return [
    ...branches.map((branch) => ({ key: `branch:${branch.name}`, label: branch.name, branch: branch.name })),
    ...pulls.map((pull) => ({ key: `pr:${pull.number}`, label: `PR #${pull.number}  ${pull.title}`, branch: pull.head, pr: pull.number })),
  ]
}

export default function RepoPicker() {
  const { projects } = useProject()
  const [picker, setPicker] = useState<PickerState>(START)
  const [auth, setAuth] = useState<GithubAuth | null>(null)
  const [repos, setRepos] = useState<GithubRepo[]>(() => cached<GithubRepo>(REPO_CACHE))
  const [branches, setBranches] = useState<GithubBranch[]>([])
  const [pulls, setPulls] = useState<GithubPull[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<OpenPlan | null>(null)
  const [prompt, setPrompt] = useState<{ row: Row; plan: Extract<OpenPlan, { kind: 'existing' }> } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const stage = picker.stage
  const repo = stage.kind === 'branches' ? stage.repo : null
  const roots = useMemo(() => projects.map((project) => project.root), [projects])

  useEffect(() => {
    let live = true
    window.architect
      .githubAuth()
      .then((result) => {
        if (live) setAuth(result.ok ? result.value : null)
      })
      .catch(() => {})

    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (repo) return

    let live = true
    setLoading(true)
    window.architect
      .githubRepos()
      .then((result) => {
        if (!live) return
        setLoading(false)
        if (!result.ok) return setError(githubMessage(result.error))
        setError(null)
        setRepos(result.value)
        cache(REPO_CACHE, result.value)
      })
      .catch((err: unknown) => {
        if (live) {
          setLoading(false)
          setError(String(err))
        }
      })

    return () => {
      live = false
    }
  }, [repo])

  useEffect(() => {
    if (!repo) return

    const [owner = '', name = ''] = repo.nameWithOwner.split('/')
    const key = BRANCH_CACHE + repo.nameWithOwner
    setBranches(cached<GithubBranch>(key))
    setPulls([])

    let live = true
    setLoading(true)
    Promise.all([window.architect.githubBranches(owner, name), window.architect.githubPulls(owner, name)])
      .then(([listed, open]) => {
        if (!live) return
        setLoading(false)
        if (!listed.ok) return setError(githubMessage(listed.error))
        setError(null)
        setBranches(listed.value)
        cache(key, listed.value)
        if (open.ok) setPulls(open.value)
      })
      .catch((err: unknown) => {
        if (live) {
          setLoading(false)
          setError(String(err))
        }
      })

    return () => {
      live = false
    }
  }, [repo])

  const shownRepos = useMemo(
    () => rank(picker.query, repos, (item) => item.nameWithOwner),
    [picker.query, repos],
  )
  const shownRows = useMemo(
    () => rank(picker.query, rowsOf(branches, pulls), (item) => item.label),
    [picker.query, branches, pulls],
  )

  const count = repo ? shownRows.length : shownRepos.length
  const index = Math.min(picker.index, Math.max(count - 1, 0))
  const highlight = repo ? shownRows[index] : undefined
  const highlightRepo = repo ? null : shownRepos[index]

  useEffect(() => {
    if (!repo || !highlight) return setPlan(null)

    let live = true
    setPlan(null)
    window.architect
      .repoPlan(repo.nameWithOwner, highlight.branch, highlight.pr)
      .then((result) => {
        if (!live) return
        setPlan(result.ok ? result.value : null)
        if (!result.ok) setMessage(gitMessage(result.error))
      })
      .catch(() => {})

    return () => {
      live = false
    }
  }, [repo, highlight?.key])

  async function run(row: Row, choice: OpenChoice, label: string): Promise<void> {
    if (!repo) return
    setPrompt(null)
    setBusy(label)
    setMessage(null)

    const opened = await window.architect.repoOpen(repo.nameWithOwner, row.branch, choice, row.pr)
    setBusy(null)
    if (!opened.ok) return setMessage(openMessage(opened.error))

    setMessage(opened.value.warning)
    openProject(opened.value.path)
  }

  async function choose(row: Row): Promise<void> {
    if (!repo || busy) return

    const planned = await window.architect.repoPlan(repo.nameWithOwner, row.branch, row.pr)
    if (!planned.ok) return setMessage(gitMessage(planned.error))
    if (planned.value.kind === 'existing') return setPrompt({ row, plan: planned.value })

    const label = planned.value.kind === 'clone' ? `Cloning ${repo.nameWithOwner}...` : `Opening ${row.label}...`
    await run(row, 'keep', label)
  }

  function onKey(event: React.KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      return setPicker(moved({ ...picker, index }, event.key === 'ArrowDown' ? 1 : -1, count))
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      if (prompt) return
      if (repo && highlight) return void choose(highlight)
      if (!repo && highlightRepo) return setPicker(entered(picker, highlightRepo))
      return
    }

    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (prompt) return setPrompt(null)

    const back = escaped(picker)
    setPicker(back ?? START)
    setMessage(null)
  }

  const note = auth ? authNote(auth) : null

  return (
    <>
      <header className="canvas-header">
        <h2>{repo ? repo.nameWithOwner : 'Repos'}</h2>
        {loading && <span className="muted">Loading…</span>}
        {busy && <span className="muted">{busy}</span>}
      </header>

      <div className="picker">
        <div className="picker-main">
          <input
            ref={input}
            className="picker-prompt"
            autoFocus
            placeholder={repo ? 'Filter branches' : 'Filter repos'}
            value={picker.query}
            onChange={(event) => setPicker(typed(picker, event.target.value))}
            onKeyDown={onKey}
            aria-label={repo ? 'Filter branches' : 'Filter repos'}
          />

          {note && (
            <p className="picker-note">
              {note.text}
              <code>{note.action}</code>
            </p>
          )}
          {error && <p className="picker-error">{error}</p>}
          {message && <p className="picker-note">{message}</p>}

          <ul className="picker-list">
            {!repo &&
              shownRepos.map((item, at) => {
                const open = openedAs(roots, item)
                return (
                  <li key={item.nameWithOwner}>
                    <button
                      className={at === index ? 'picker-row active' : 'picker-row'}
                      onClick={() => setPicker(entered({ ...picker, index: at }, item))}
                    >
                      <span className="picker-name">{item.nameWithOwner}</span>
                      <span className="picker-meta">
                        {item.isPrivate ? 'private' : 'public'}
                        {item.defaultBranch ? ` · ${item.defaultBranch}` : ''}
                        {open ? ' · open' : ''}
                      </span>
                    </button>
                  </li>
                )
              })}

            {repo &&
              shownRows.map((row, at) => (
                <li key={row.key}>
                  <button
                    className={at === index ? 'picker-row active' : 'picker-row'}
                    onClick={() => {
                      setPicker({ ...picker, index: at })
                      void choose(row)
                    }}
                  >
                    <span className="picker-name">{row.label}</span>
                    {row.branch === repo.defaultBranch && <span className="picker-meta">default</span>}
                  </button>
                </li>
              ))}

            {count === 0 && !loading && <li className="empty">Nothing matches</li>}
          </ul>
        </div>

        <aside className="picker-preview">
          {highlightRepo && (
            <>
              <h4>{highlightRepo.nameWithOwner}</h4>
              <p className="goto-hint">{highlightRepo.description || 'No description'}</p>
              <p className="goto-hint">
                {highlightRepo.isPrivate ? 'private' : 'public'}
                {highlightRepo.isFork ? ' · fork' : ''}
                {highlightRepo.isArchived ? ' · archived' : ''}
                {highlightRepo.language ? ` · ${highlightRepo.language}` : ''}
              </p>
              <p className="goto-hint">{pushedText(highlightRepo.pushedAt)}</p>
              <p className="goto-hint">default branch: {highlightRepo.defaultBranch ?? 'unknown'}</p>
              {openedAs(roots, highlightRepo) && (
                <p className="goto-hint">already open at {openedAs(roots, highlightRepo)}</p>
              )}
            </>
          )}

          {repo && highlight && (
            <>
              <h4>Local-only changes</h4>
              {!plan && <p className="goto-hint">Reading the clone…</p>}
              {plan?.kind === 'clone' && <p className="goto-hint">No clone yet. Opening clones into {plan.basePath}.</p>}
              {plan?.kind === 'fresh' && (
                <p className="goto-hint">No local checkout. Opening creates {plan.worktreePath} from the remote.</p>
              )}
              {plan?.kind === 'existing' && (
                <>
                  <p className="goto-hint">{plan.existing}</p>
                  <p className="goto-hint">{riskText(plan.risk)} against {plan.risk.tracking}</p>
                  <pre className="picker-pre">
                    {[...plan.risk.dirtyFiles, ...plan.risk.unpushedCommits].join('\n') || 'clean'}
                  </pre>
                </>
              )}
            </>
          )}
        </aside>
      </div>

      {prompt && (
        <div className="picker-prompt-box" role="dialog" aria-label="Keep or clean">
          <p className="picker-prompt-head">
            {prompt.row.branch} - {riskText(prompt.plan.risk)} in {basename(prompt.plan.existing)}:
          </p>
          <button className="sidebar-action" onClick={() => void run(prompt.row, 'keep', `Opening ${prompt.row.label}...`)}>
            Keep changes &nbsp; pull {prompt.plan.risk.tracking} via rebase --autostash
          </button>
          <button className="sidebar-action danger" onClick={() => void run(prompt.row, 'clean', `Wiping ${prompt.row.branch}...`)}>
            Clean pull &nbsp; DELETE the worktree, recreate from {prompt.plan.risk.tracking}
            {riskText(prompt.plan.risk) === 'nothing local' ? '' : `  [loses ${riskText(prompt.plan.risk)}]`}
          </button>
          <button
            className="sidebar-action"
            onClick={() => {
              setPrompt(null)
              setMessage(`Cancelled: ${prompt.row.branch} left as it is`)
              input.current?.focus()
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </>
  )
}
