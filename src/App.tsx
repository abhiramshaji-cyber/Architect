import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Architecture, Pending } from '../shared/types'
import Canvas, { hasCycle } from './Canvas'

type ProjectSummary = { root: string; title: string }

function describe(p: Pending): string {
  const proposal = p.proposal
  if (proposal.kind === 'component') return `new component: ${proposal.id}`
  if (proposal.kind === 'edge') return `new edge: ${proposal.from} → ${proposal.to}`
  if (proposal.kind === 'package') return `new package: ${proposal.name} on ${proposal.component}`
  return `new file: ${proposal.path}`
}

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [currentRoot, setCurrentRoot] = useState<string | null>(null)
  const [architecture, setArchitecture] = useState<Architecture | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  useEffect(() => {
    window.architect.projects().then(setProjects)
    window.architect.pending().then(setPending)
    window.architect.onChange(setArchitecture)
    window.architect.onPending(setPending)
  }, [])

  const openProject = useCallback((root: string) => {
    window.architect.open(root).then((a) => {
      setArchitecture(a)
      setCurrentRoot(root)
    })
  }, [])

  const projectPending = useMemo(
    () => pending.filter((p) => p.projectRoot === currentRoot),
    [pending, currentRoot]
  )

  const decide = useCallback((id: string, approved: boolean, r?: string) => {
    void window.architect.decide(id, approved, r)
    setRejecting(null)
    setReason('')
  }, [])

  const move = useCallback((id: string, x: number, y: number) => {
    void window.architect.move(id, x, y)
  }, [])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-section">
          <h1>Architect</h1>
          <ul className="project-list">
            {projects.map((p) => (
              <li key={p.root}>
                <button
                  className={p.root === currentRoot ? 'project active' : 'project'}
                  onClick={() => openProject(p.root)}
                >
                  {p.title}
                </button>
              </li>
            ))}
            {projects.length === 0 && <li className="empty">No projects registered</li>}
          </ul>
        </div>

        <div className="sidebar-section inbox">
          <h2>Approval inbox</h2>
          <ul className="pending-list">
            {pending.map((p) => {
              const cycle =
                architecture && p.proposal.kind === 'edge'
                  ? hasCycle(architecture.edges, p.proposal.from, p.proposal.to)
                  : false
              return (
                <li key={p.id} className="pending-item">
                  <div className="pending-summary">{describe(p)}</div>
                  <div className="pending-rationale">{p.rationale}</div>
                  {cycle && <div className="pending-cycle">would introduce a cycle</div>}
                  {rejecting === p.id ? (
                    <div className="reject-form">
                      <input
                        autoFocus
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="reason"
                      />
                      <button onClick={() => decide(p.id, false, reason)}>send</button>
                      <button onClick={() => setRejecting(null)}>cancel</button>
                    </div>
                  ) : (
                    <div className="pending-actions">
                      <button className="approve" onClick={() => decide(p.id, true)}>
                        approve
                      </button>
                      <button className="reject" onClick={() => setRejecting(p.id)}>
                        reject
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
            {pending.length === 0 && <li className="empty">Nothing pending</li>}
          </ul>
        </div>
      </aside>

      <main className="canvas-area">
        {architecture ? (
          <>
            <header className="canvas-header">
              <h2>{architecture.title}</h2>
              <p>{architecture.summary}</p>
            </header>
            <Canvas architecture={architecture} pending={projectPending} onMove={move} />
          </>
        ) : (
          <div className="empty-state">Select a project to open its architecture</div>
        )}
      </main>
    </div>
  )
}
