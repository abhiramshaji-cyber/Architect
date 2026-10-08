import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { folderName } from '../../model/layout'
import { cache, cached, isClaudeWorktree, moved, rank, START, typed, worktreeText, type PickerState } from '../../model/picker'
import { isStale } from '../../model/removal'
import { openProject } from '../../model/store'
import Locations from './Locations'
import Panel from './Panel'
import { useRemoval } from './useRemoval'
import WorktreeRows, { useChecks } from './WorktreeRows'
import type { ClaudeWorktree } from '../../../shared/types'

const WORKTREE_CACHE = 'claude:worktrees'
const SHOWN = 300

function choose(worktree: ClaudeWorktree): void {
  if (!worktree.broken) openProject(worktree.path)
}

export default function WorktreePicker() {
  const [worktrees, setWorktrees] = useState<ClaudeWorktree[]>(() => cached<unknown>(WORKTREE_CACHE).filter(isClaudeWorktree))
  const [picker, setPicker] = useState<PickerState>(START)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  const { checked, check, toggle, mark, clear } = useChecks(shown)
  const picked = useMemo(() => worktrees.filter((worktree) => checked.has(worktree.path)), [worktrees, checked])

  const removal = useRemoval((path) => {
    known.current = known.current.filter((row) => row.path !== path)
    setWorktrees(known.current)
    check([path], false)
  }, () => load(false, true))

  const index = Math.min(picker.index, Math.max(shown.length - 1, 0))
  const highlight = shown[index]
  const working = removal.stage.kind === 'surveying' || removal.stage.kind === 'removing'

  function pick(event: React.MouseEvent, at: number): void {
    mark(event, at)
    setPicker({ ...picker, index: at })
  }

  function onKey(event: React.KeyboardEvent, typing: boolean): void {
    if ((event.target as HTMLInputElement).type === 'checkbox') return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      return setPicker(moved({ ...picker, index }, event.key === 'ArrowDown' ? 1 : -1, shown.length))
    }

    if (event.key === 'Enter' && highlight) {
      event.preventDefault()
      return choose(highlight)
    }

    if (event.key === ' ' && highlight) {
      event.preventDefault()
      return toggle(highlight.path)
    }

    if (event.key === 'a' && (event.metaKey || event.ctrlKey) && !(typing && picker.query !== '')) {
      event.preventDefault()
      return check(shown.map((row) => row.path), true)
    }

    if (event.key === 'Escape' && checked.size > 0) {
      event.preventDefault()
      event.stopPropagation()
      clear()
    }
  }

  return (
    <>
      <header className="canvas-header">
        <h2>Worktrees</h2>
        <span className="muted">{scanning ? 'Scanning…' : `${visible.length} of ${worktrees.length} found`}</span>
        {picked.length > 0 && (
          <>
            <span className="muted">{picked.length} selected</span>
            <button className="pane-action" onClick={clear}>
              Clear
            </button>
            <button className="pane-action danger" onClick={() => void removal.survey(picked)} disabled={working}>
              Delete {picked.length}…
            </button>
          </>
        )}
        <button className="pane-action" onClick={() => check(shown.filter((worktree) => isStale(worktree, now)).map((worktree) => worktree.path), true)}>
          Select stale
        </button>
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
            onKeyDown={(event) => onKey(event, true)}
            aria-label="Filter worktrees"
          />

          {locating && <Locations onSaved={() => load(true, true)} />}
          {error && <p className="picker-error">{error}</p>}

          <ul className="picker-list" onKeyDown={(event) => onKey(event, false)}>
            <WorktreeRows shown={shown} index={index} checked={checked} now={now} onPick={pick} onToggle={toggle} onOpen={choose} />

            {ranked.length > shown.length && <li className="empty">{ranked.length - shown.length} more match. Keep typing to narrow.</li>}

            {shown.length === 0 && !scanning && (
              <li className="empty">{visible.length > 0 ? 'Nothing matches' : everything ? 'No worktrees found' : 'No Claude Code worktrees found'}</li>
            )}
          </ul>
        </div>

        <aside className="picker-preview">
          <Panel
            highlight={highlight}
            now={now}
            stage={removal.stage}
            onStage={removal.setStage}
            onSurvey={(worktrees) => void removal.survey(worktrees)}
            onRemove={() => removal.stage.kind === 'review' && void removal.remove(removal.stage.review, removal.stage.force, removal.stage.branches)}
          />
        </aside>
      </div>
    </>
  )
}
