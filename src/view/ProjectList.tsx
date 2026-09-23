import { folderName } from '../model/layout'
import { closeProject, openProject, useProject } from '../model/store'

export default function ProjectList() {
  const { projects, currentRoot, entries } = useProject()
  if (projects.length === 0) return null

  return (
    <div className="open-projects">
      <h3>Open</h3>
      <ul className="project-list">
        {projects.map((p) => {
          const folder = folderName(p.root)
          const entry = entries[p.root]
          const close = `Close ${folder}`
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
              <button className="project-close" aria-label={close} title={close} onClick={() => closeProject(p.root)}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
