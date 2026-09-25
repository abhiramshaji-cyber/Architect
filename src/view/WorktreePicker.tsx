import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { folderName } from '../model/layout'
import {
  BROKEN_TEXT,
  agoText,
  cache,
  cached,
  distanceText,
  gitMessage,
  isClaudeWorktree,
  moved,
  rank,
  START,
  typed,
  worktreeText,
  type PickerState,
} from '../model/picker'
import { openProject } from '../model/store'
import type { BaseDistance, ClaudeWorktree, GitResult } from '../../shared/types'

const WORKTREE_CACHE = 'claude:worktrees'
const SHOWN = 300

function distanceLine(result: GitResult<BaseDistance> | null): string {
  if (!result) return 'Counting against the default branch…'
  if (!result.ok) return gitMessage(result.error)

  return `${distanceText(result.value)} against ${result.value.base}`
}

export default function WorktreePicker() {
  const [worktrees, setWorktrees] = useState<ClaudeWorktree[]>(() => cached<unknown>(WORKTREE_CACHE).filter(isClaudeWorktree))
  const [picker, setPicker] = useState<PickerState>(START)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [distance, setDistance] = useState<GitResult<BaseDistance> | null>(null)
  const known = useRef(worktrees)
  const latest = useRef(0)
  const busy = useRef(false)

  const load = useCallback((scan: boolean) => {
    if (!scan && busy.current) return

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
  const ranked = useMemo(
    () => rank(picker.query, worktrees, (worktree) => `${folderName(worktree.repo)} ${worktree.name} ${worktreeText(worktree, now)}`),
    [picker.query, worktrees],
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
        <span className="muted">{scanning ? 'Scanning…' : `${worktrees.length} found`}</span>
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

          {error && <p className="picker-error">{error}</p>}

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
              <li className="empty">{worktrees.length === 0 ? 'No Claude Code worktrees found' : 'Nothing matches'}</li>
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
            </>
          )}
        </aside>
      </div>
    </>
  )
}
