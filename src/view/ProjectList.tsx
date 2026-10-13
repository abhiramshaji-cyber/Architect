import { folderName } from '../model/layout'
import { closeProject, openProject, useProject } from '../model/store'
import Icon from './Icon'

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
            <li key={p.root} className="project-row">
              <button
                className={p.root === currentRoot ? 'project active' : 'project'}
                onClick={() => openProject(p.root)}
                title={entry?.status === 'error' ? entry.error ?? undefined : undefined}
              >
                <span className="project-folder">{folder}</span>
                {p.title !== folder && <span className="project-title">{p.title}</span>}
                {entry?.status === 'error' && <span className="project-unavailable">unavailable</span>}
              </button>
              <button className="icon-button project-close" aria-label={close} title={close} onClick={() => closeProject(p.root)}>
                <Icon name="close" size={14} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
