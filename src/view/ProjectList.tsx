import { folderName } from '../model/layout'
import { closeProject, openProject, useProject } from '../model/store'

type Props = {
  theme: string
  onFlipTheme: () => void
  onConnectMcp: () => void
}

export default function ProjectList({ theme, onFlipTheme, onConnectMcp }: Props) {
  const { projects, currentRoot, entries } = useProject()
  const label = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'

  return (
    <div className="sidebar-section">
      <div className="sidebar-header">
        <h1>Architect</h1>
        <button className="theme-toggle" onClick={onFlipTheme} aria-label={label} title={label}>
          {theme === 'light' ? (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="4" />
              <path
                d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
      </div>
      <ul className="project-list">
        {projects.map((p) => {
          const folder = folderName(p.root)
          const entry = entries[p.root]
          return (
            <li key={p.root}>
              <button
                className={p.root === currentRoot ? 'project active' : 'project'}
                onClick={() => openProject(p.root)}
                title={entry?.status === 'error' ? entry.error ?? undefined : undefined}
              >
                <span className="project-folder">{folder}</span>
                {p.title !== folder && <span className="project-title">{p.title}</span>}
                {entry?.status === 'error' && <span className="project-unavailable">unavailable</span>}
              </button>
              {entry && (
                <button
                  className="project-close"
                  aria-label={`Close ${folder}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    closeProject(p.root)
                  }}
                >
                  ×
                </button>
              )}
            </li>
          )
        })}
        {projects.length === 0 && <li className="empty">No projects yet</li>}
      </ul>
      <button className="sidebar-action" onClick={onConnectMcp}>
        Connect MCP
      </button>
    </div>
  )
}
