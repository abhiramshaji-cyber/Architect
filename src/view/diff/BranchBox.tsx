import { useEffect, useState } from 'react'
import type { ChangedFile, GitStatus, GithubPull } from '../../../shared/types'
import { draftMessage, githubMessage, gitMessage } from '../../model/picker'
import { Files, type Selected } from './Files'
import { useWork } from './work'

function syncLabel(state: GitStatus, commits: number): string | null {
  if (state.head.kind !== 'branch') return null
  if (state.upstream === null) return commits > 0 ? 'Publish' : null
  if (state.ahead > 0 && state.behind > 0) return `Sync ↑${state.ahead} ↓${state.behind}`
  if (state.ahead > 0) return `Push ↑${state.ahead}`
  if (state.behind > 0) return `Pull ↓${state.behind}`
  return null
}

export function SyncButton({
  root,
  state,
  commits,
  reload,
}: {
  root: string
  state: GitStatus
  commits: number
  reload: () => void
}) {
  const { busy, note, act } = useWork<'sync'>()
  const label = syncLabel(state, commits)
  if (label === null && note === null) return null

  const sync = () =>
    act('sync', async () => {
      if (state.upstream !== null && state.behind > 0) {
        const pulled = await window.architect.gitPull(root)
        if (!pulled.ok) return gitMessage(pulled.error)
      }

      if (state.upstream === null || state.ahead > 0) {
        const pushed = await window.architect.gitPush(root)
        if (!pushed.ok) return gitMessage(pushed.error)
      }

      reload()
      return null
    })

  return (
    <>
      {label && (
        <button className="ghost" onClick={() => void sync()} disabled={busy !== null}>
          {busy ? 'Syncing…' : label}
        </button>
      )}
      {note && <p className="diff-section-note error">{note}</p>}
    </>
  )
}

export function BranchBox({
  root,
  state,
  commits,
  files,
  prefix,
  selected,
  onSelect,
}: {
  root: string
  state: GitStatus
  commits: number
  files: ChangedFile[]
  prefix: string
  selected: Selected | null
  onSelect: (selected: Selected) => void
}) {
  const [open, setOpen] = useState(false)
  const [base, setBase] = useState<string | null>(null)
  const [existing, setExisting] = useState<GithubPull | null>(null)
  const [form, setForm] = useState<{ title: string; body: string } | null>(null)
  const { busy, note, act } = useWork<'draft' | 'open'>()
  const branch = state.head.kind === 'branch' ? state.head.branch : null

  useEffect(() => {
    if (branch === null) return

    let live = true
    void window.architect.gitDefaultBranch(root).then((found) => {
      if (live) setBase(found.ok ? found.value.branch : null)
    })
    void window.architect
      .githubPullFor(root, branch)
      .then((found) => {
        if (live) setExisting(found.ok ? found.value : null)
      })
      .catch(() => {})

    return () => {
      live = false
    }
  }, [root, branch])

  const draft = () =>
    act('draft', async () => {
      const drafted = await window.architect.draftPullRequest(root)
      setForm(drafted.ok ? drafted.value : { title: '', body: '' })
      return drafted.ok ? null : draftMessage(drafted.error)
    })

  const create = () =>
    act('open', async () => {
      if (form === null || base === null || branch === null) return null
      const opened = await window.architect.githubCreatePull(root, base, branch, form.title, form.body)
      if (!opened.ok) return githubMessage(opened.error)

      setExisting(opened.value)
      setForm(null)
      return null
    })

  const canOpen = existing === null && branch !== null && base !== null && branch !== base && state.upstream !== null

  return (
    <section className="diff-section">
      <div className="diff-branch-row">
        <button className="diff-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {`${open ? '▾' : '▸'} ${commits} ${commits === 1 ? 'commit' : 'commits'} ahead${base ? ` of ${base}` : ''}`}
        </button>
        {existing && (
          <a href={existing.url} target="_blank" rel="noreferrer">
            #{existing.number}
          </a>
        )}
        {canOpen && form === null && (
          <button className="ghost" onClick={() => void draft()} disabled={busy !== null}>
            {busy === 'draft' ? 'Writing…' : 'Open pull request'}
          </button>
        )}
      </div>

      {open && <Files section="branch" files={files} prefix={prefix} selected={selected} onSelect={onSelect} />}

      {form && (
        <div className="commit-box">
          <input
            className="commit-title"
            value={form.title}
            placeholder="Title"
            aria-label="Pull request title"
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
          <textarea
            className="commit-description"
            value={form.body}
            placeholder="Body"
            rows={6}
            onChange={(event) => setForm({ ...form, body: event.target.value })}
          />
          <div className="commit-actions">
            <button
              className="primary"
              onClick={() => void create()}
              disabled={busy !== null || form.title.trim() === ''}
            >
              {busy === 'open' ? 'Opening…' : 'Open'}
            </button>
            <button className="ghost" onClick={() => setForm(null)} disabled={busy !== null}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {note && <p className="diff-section-note">{note}</p>}
    </section>
  )
}
