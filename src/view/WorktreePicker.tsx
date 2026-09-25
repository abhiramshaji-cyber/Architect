import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { folderName } from '../model/layout'
import {
  BROKEN_TEXT,
  agoText,
  branchPrompt,
  cache,
  cached,
  dirtyPrompt,
  distanceText,
  gitMessage,
  isClaudeWorktree,
  moved,
  rank,
  removalMessage,
  removalPrompt,
  removedText,
  settingsMessage,
  START,
  typed,
  worktreeText,
  type PickerState,
} from '../model/picker'
import { openProject } from '../model/store'
import type { BaseDistance, ClaudeWorktree, GitResult, SettingsProblem, WorktreeSettings } from '../../shared/types'

const WORKTREE_CACHE = 'claude:worktrees'
const SHOWN = 300

function distanceLine(result: GitResult<BaseDistance> | null): string {
  if (!result) return 'Counting against the default branch…'
  if (!result.ok) return gitMessage(result.error)

  return `${distanceText(result.value)} against ${result.value.base}`
}

function Locations({ onSaved }: { onSaved: () => void }) {
  const [settings, setSettings] = useState<WorktreeSettings | null>(null)
  const [depth, setDepth] = useState('')
  const [folder, setFolder] = useState('')
  const [problems, setProblems] = useState<string[]>([])

  useEffect(() => {
    window.architect.worktreeSettings().then(
      (loaded) => {
        setSettings(loaded)
        setDepth(String(loaded.worktreeScanDepth))
      },
      (err: unknown) => setProblems([String(err)]),
    )
  }, [])

  async function save(next: WorktreeSettings): Promise<boolean> {
    const saved = await window.architect.saveWorktreeSettings(next).catch((err: unknown) => ({ ok: false as const, error: String(err) }))
    if (!saved.ok) {
      setProblems(typeof saved.error === 'string' ? [saved.error] : saved.error.map((problem: SettingsProblem) => settingsMessage(problem)))
      return false
    }

    setProblems([])
    setSettings(saved.value)
    setDepth(String(saved.value.worktreeScanDepth))
    onSaved()
    return true
  }

  if (!settings) return problems.length > 0 ? <p className="picker-error">{problems[0]}</p> : null

  async function addRoot(current: WorktreeSettings): Promise<void> {
    const picked = await window.architect.pickFolder()
    if (picked) await save({ ...current, worktreeRoots: [...current.worktreeRoots, picked] })
  }

  async function addFolder(current: WorktreeSettings): Promise<void> {
    if (await save({ ...current, worktreeFolders: [...current.worktreeFolders, folder.trim()] })) setFolder('')
  }

  function commitDepth(current: WorktreeSettings): void {
    const next = depth.trim() === '' ? Number.NaN : Number(depth)
    if (next !== current.worktreeScanDepth) void save({ ...current, worktreeScanDepth: next })
  }

  return (
    <section className="picker-locations" aria-label="Worktree locations">
      <p className="goto-hint">Scan these folders for git repos, then list every worktree git reports for each repo.</p>
      <ul className="picker-locations-list">
        {settings.worktreeRoots.map((root) => (
          <li key={root}>
            <code>{root}</code>
            <button className="pane-action" onClick={() => void save({ ...settings, worktreeRoots: settings.worktreeRoots.filter((item) => item !== root) })}>
              Remove
            </button>
          </li>
        ))}
        {settings.worktreeRoots.length === 0 && <li className="goto-hint">No scan folders, so only open projects are checked</li>}
      </ul>
      <div className="picker-locations-row">
        <button className="pane-action" onClick={() => void addRoot(settings)}>
          Add scan folder…
        </button>
        <label className="goto-hint">
          Depth{' '}
          <input
            className="picker-prompt picker-depth"
            type="number"
            min={0}
            step={1}
            value={depth}
            onChange={(event) => setDepth(event.target.value)}
            onBlur={() => commitDepth(settings)}
            onKeyDown={(event) => event.key === 'Enter' && commitDepth(settings)}
          />
        </label>
      </div>

      <p className="goto-hint">Worktrees inside these folders count as Claude worktrees. A relative folder is inside each repo.</p>
      <ul className="picker-locations-list">
        {settings.worktreeFolders.map((item) => (
          <li key={item}>
            <code>{item}</code>
            <button className="pane-action" onClick={() => void save({ ...settings, worktreeFolders: settings.worktreeFolders.filter((other) => other !== item) })}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="picker-locations-row"
        onSubmit={(event) => {
          event.preventDefault()
          void addFolder(settings)
        }}
      >
        <input
          className="picker-prompt"
          placeholder=".claude/worktrees or an absolute path"
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
          aria-label="Worktree folder"
        />
        <button className="pane-action" type="submit">
          Add
        </button>
      </form>

      {problems.map((problem) => (
        <p key={problem} className="picker-error">
          {problem}
        </p>
      ))}
    </section>
  )
}

export default function WorktreePicker() {
  const [worktrees, setWorktrees] = useState<ClaudeWorktree[]>(() => cached<unknown>(WORKTREE_CACHE).filter(isClaudeWorktree))
  const [picker, setPicker] = useState<PickerState>(START)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [distance, setDistance] = useState<GitResult<BaseDistance> | null>(null)
  const [outcome, setOutcome] = useState<{ text: string; failed: boolean } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [everything, setEverything] = useState(false)
  const [locating, setLocating] = useState(false)
  const known = useRef(worktrees)
  const latest = useRef(0)
  const busy = useRef(false)

  const load = useCallback((scan: boolean, urgent = false) => {
    if (!scan && !urgent && busy.current) return

    const run = ++latest.current
    busy.current = true
    setScanning(true)

    const repos = [...new Set(known.current.map((worktree) => worktree.repo))]
    window.architect
      .claudeWorktrees(repos, scan)
      .then(
        (found) => {
          if (run !== latest.current) return
          known.current = found
          setWorktrees(found)
          setError(null)
          cache(WORKTREE_CACHE, found)
        },
        (err: unknown) => {
          if (run === latest.current) setError(String(err))
        },
      )
      .finally(() => {
        if (run !== latest.current) return
        busy.current = false
        setScanning(false)
      })
  }, [])

  useEffect(() => {
    load(known.current.length === 0)

    const refresh = () => load(false)
    window.addEventListener('focus', refresh)

    return () => {
      window.removeEventListener('focus', refresh)
      latest.current += 1
      busy.current = false
    }
  }, [load])

  const now = Date.now()
  const visible = useMemo(() => (everything ? worktrees : worktrees.filter((worktree) => worktree.claude)), [everything, worktrees])
  const ranked = useMemo(
    () => rank(picker.query, visible, (worktree) => `${folderName(worktree.repo)} ${worktree.name} ${worktreeText(worktree, now)}`),
    [picker.query, visible],
  )
  const shown = useMemo(() => ranked.slice(0, SHOWN), [ranked])

  const index = Math.min(picker.index, Math.max(shown.length - 1, 0))
  const highlight = shown[index]

  useEffect(() => {
    setDistance(null)
    if (!highlight || highlight.broken) return

    let live = true
    window.architect
      .gitDistance(highlight.path)
      .then((result) => {
        if (live) setDistance(result)
      })
      .catch(() => {})

    return () => {
      live = false
    }
  }, [highlight?.path, highlight?.broken])

  function choose(worktree: ClaudeWorktree): void {
    if (!worktree.broken) openProject(worktree.path)
  }

  async function deleteWorktree(worktree: ClaudeWorktree): Promise<void> {
    setOutcome(null)
    const surveyed = await window.architect.claudeWorktreeSurvey(worktree.repo, worktree.path)
    if (!surveyed.ok) return setOutcome({ text: removalMessage(surveyed.error), failed: true })

    const plan = surveyed.value
    if (!confirm(removalPrompt(worktree, plan))) return
    const force = plan.kind === 'remove' && plan.dirty > 0
    if (force && !confirm(dirtyPrompt(worktree, plan.dirty))) return
    const branch = plan.kind === 'remove' && plan.merged && plan.branch !== null && plan.base !== null && confirm(branchPrompt(plan.branch, plan.base))

    const removed = await window.architect.claudeWorktreeRemove(worktree.repo, worktree.path, { force, branch })
    if (removed.ok) {
      known.current = known.current.filter((row) => row.path !== worktree.path)
      setWorktrees(known.current)
    }

    setOutcome(removed.ok ? { text: removedText(worktree, removed.value), failed: false } : { text: removalMessage(removed.error), failed: true })
    load(false, true)
  }

  function onDelete(worktree: ClaudeWorktree): void {
    setDeleting(true)
    deleteWorktree(worktree)
      .catch((err: unknown) => setOutcome({ text: String(err), failed: true }))
      .finally(() => setDeleting(false))
  }

  function onKey(event: React.KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      return setPicker(moved({ ...picker, index }, event.key === 'ArrowDown' ? 1 : -1, shown.length))
    }

    if (event.key === 'Enter' && highlight) {
      event.preventDefault()
      choose(highlight)
    }
  }

  return (
    <>
      <header className="canvas-header">
        <h2>Worktrees</h2>
        <span className="muted">{scanning ? 'Scanning…' : `${visible.length} of ${worktrees.length} found`}</span>
        <button className="pane-action" aria-pressed={everything} onClick={() => setEverything(!everything)}>
          {everything ? 'All worktrees' : 'Claude only'}
        </button>
        <button className="pane-action" aria-expanded={locating} onClick={() => setLocating(!locating)}>
          Locations
        </button>
        <button className="pane-action" onClick={() => load(true)} disabled={scanning}>
          Refresh
        </button>
      </header>

      <div className="picker">
        <div className="picker-main">
          <input
            className="picker-prompt"
            autoFocus
            placeholder="Filter worktrees"
            value={picker.query}
            onChange={(event) => setPicker(typed(picker, event.target.value))}
            onKeyDown={onKey}
            aria-label="Filter worktrees"
          />

          {locating && <Locations onSaved={() => load(true, true)} />}
          {error && <p className="picker-error">{error}</p>}
          {outcome && <p className={outcome.failed ? 'picker-error' : 'goto-hint'}>{outcome.text}</p>}

          <ul className="picker-list">
            {shown.map((worktree, at) => (
              <li key={worktree.path}>
                <button
                  className={at === index ? 'picker-row active' : 'picker-row'}
                  onClick={() => {
                    setPicker({ ...picker, index: at })
                    choose(worktree)
                  }}
                >
                  <span className="picker-name">
                    {folderName(worktree.repo)} / {worktree.name}
                  </span>
                  <span className="picker-meta">{worktreeText(worktree, now)}</span>
                </button>
              </li>
            ))}

            {ranked.length > shown.length && (
              <li className="empty">{ranked.length - shown.length} more match. Keep typing to narrow.</li>
            )}

            {shown.length === 0 && !scanning && (
              <li className="empty">{visible.length > 0 ? 'Nothing matches' : everything ? 'No worktrees found' : 'No Claude Code worktrees found'}</li>
            )}
          </ul>
        </div>

        <aside className="picker-preview">
          {highlight && (
            <>
              <h4>{highlight.name}</h4>
              <p className="goto-hint">{highlight.path}</p>
              <p className="goto-hint">repo: {highlight.repo}</p>
              <p className="goto-hint">branch: {highlight.branch ?? 'detached'}</p>
              {highlight.broken ? (
                <p className="goto-hint">Broken: {BROKEN_TEXT[highlight.broken]}</p>
              ) : (
                <>
                  <p className="goto-hint">{distanceLine(distance)}</p>
                  <p className="goto-hint">
                    {highlight.dirty ? 'uncommitted changes' : 'clean'} · {agoText(highlight.changedAt, now)}
                  </p>
                </>
              )}
              <button className="action danger" onClick={() => onDelete(highlight)} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete worktree…'}
              </button>
            </>
          )}
        </aside>
      </div>
    </>
  )
}
