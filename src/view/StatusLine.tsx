import { useEffect, useSyncExternalStore } from 'react'
import { pendingHere, type ProjectState } from '../model/store'
import { registerSegment, segmentList, subscribeSegments } from './segments'

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
