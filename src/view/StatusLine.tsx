import { useEffect, useState, useSyncExternalStore } from 'react'
import type { GitResult, GitStatus } from '../../shared/types'
import { isDirty } from '../model/buffer'
import { pendingHere, type ProjectState } from '../model/store'
import { gitText } from './git-segment'
import { registerSegment, segmentList, subscribeSegments } from './segments'

const GIT_POLL_MS = 3000

function projectName(root: string | null): string {
  if (!root) return 'No project'
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root
}

export type StatusLineProps = {
  project: ProjectState
  parseError: string | null
  viewLabel: string | null
  theme: string
  onFlipTheme: () => void
}

export default function StatusLine({ project, parseError, viewLabel, theme, onFlipTheme }: StatusLineProps) {
  useEffect(
    () => registerSegment({ id: 'core.project', order: 0, text: projectName(project.currentRoot) }),
    [project.currentRoot]
  )

  const root = project.currentRoot
  const [git, setGit] = useState<GitResult<GitStatus> | null>(null)

  useEffect(() => {
    setGit(null)
    if (!root) return

    let live = true
    const read = () => {
      if (document.visibilityState === 'hidden') return
      window.architect
        .gitStatus(root)
        .then((result) => {
          if (live) setGit(result)
        })
        .catch(() => {
          if (live) setGit(null)
        })
    }

    read()
    const timer = setInterval(read, GIT_POLL_MS)
    window.addEventListener('focus', read)
    document.addEventListener('visibilitychange', read)

    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('focus', read)
      document.removeEventListener('visibilitychange', read)
    }
  }, [root])

  useEffect(() => registerSegment({ id: 'core.git', order: 5, text: gitText(git) }), [git])

  useEffect(() => registerSegment({ id: 'core.view', order: 10, text: viewLabel ?? '' }), [viewLabel])

  const waiting = pendingHere(project).length
  useEffect(
    () =>
      registerSegment({
        id: 'core.pending',
        order: 15,
        text: waiting === 0 ? '' : `${waiting} pending approval${waiting === 1 ? '' : 's'}`,
      }),
    [waiting]
  )

  const unsaved = isDirty(project.file) ? project.file?.path ?? '' : ''
  useEffect(
    () => registerSegment({ id: 'core.unsaved', order: 12, text: unsaved === '' ? '' : `${unsaved} [+]` }),
    [unsaved]
  )

  useEffect(() => {
    if (!parseError) return
    return registerSegment({ id: 'core.parse-error', order: 20, text: `architect.md: ${parseError}` })
  }, [parseError])

  const segments = useSyncExternalStore(subscribeSegments, segmentList)
  const label = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'

  return (
    <footer className="statusline" role="status">
      {segments.filter((segment) => segment.text).map((segment) => (
        <span
          key={segment.id}
          className={segment.id === 'core.parse-error' ? 'statusline-segment danger' : 'statusline-segment'}
          title={segment.text}
        >
          {segment.text}
        </span>
      ))}

      <button className="theme-toggle" onClick={onFlipTheme} aria-label={label} title={label}>
        {theme === 'light' ? '☾' : '☀'}
      </button>
    </footer>
  )
}
