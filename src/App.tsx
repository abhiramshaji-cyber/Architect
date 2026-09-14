import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Architecture, McpBridgeInfo, Pending } from '../shared/types'
import Canvas from './Canvas'
import ConnectMcpPanel from './ConnectMcpPanel'
import { hasCycle } from './layout'

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
  const [reassign, setReassign] = useState<Record<string, string>>({})
  const [addError, setAddError] = useState<string | null>(null)
  const [showConnectMcp, setShowConnectMcp] = useState(false)
  const [bridge, setBridge] = useState<McpBridgeInfo | null>(null)

  const openProject = useCallback((root: string) => {
    window.architect.open(root).then((a) => {
      setArchitecture(a)
      setCurrentRoot(root)
    })
  }, [])

  useEffect(() => {
    window.architect.projects().then(setProjects)
    window.architect.pending().then(setPending)
    window.architect.onChange(setArchitecture)
    window.architect.onPending(setPending)
    window.architect.onProjects(setProjects)
  }, [])

  // auto-open
  useEffect(() => {
    if (currentRoot) return
    const root = pending[0]?.projectRoot ?? projects[0]?.root
    if (root) openProject(root)
  }, [currentRoot, pending, projects, openProject])

  const projectPending = useMemo(
    () =>
      pending
        .filter((p) => p.projectRoot === currentRoot)
        .map((p) => {
          const reassigned = p.proposal.kind === 'file' ? reassign[p.id] : undefined
          if (!reassigned || p.proposal.kind !== 'file') return p
          return { ...p, proposal: { ...p.proposal, component: reassigned } }
        }),
    [pending, currentRoot, reassign]
  )

  const decide = useCallback((id: string, approved: boolean, r?: string, component?: string) => {
    void window.architect.decide(id, approved, r, component)
    setRejecting(null)
    setReason('')
  }, [])

  const approveFile = useCallback(
    (p: Pending) => {
      if (p.proposal.kind !== 'file') return
      const chosen = reassign[p.id] ?? p.proposal.component
      decide(p.id, true, undefined, chosen)
    },
    [decide, reassign]
  )

  const addProject = useCallback(async () => {
    const result = await window.architect.add()
    if (!result) return
    if ('error' in result) {
      setAddError(result.error)
      return
    }
    setAddError(null)
    openProject(result.root)
  }, [openProject])

  const openConnectMcp = useCallback(() => {
    setShowConnectMcp(true)
    setBridge(null)
    window.architect.mcpBridgeInfo().then(setBridge)
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
            {projects.length === 0 && <li className="empty">No projects yet</li>}
          </ul>
          <div className="sidebar-buttons">
            <button className="add-project" onClick={addProject}>
              Add project
            </button>
            <button className="add-project" onClick={openConnectMcp}>
              Connect MCP
            </button>
          </div>
          {addError && <p className="add-error">{addError}</p>}
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
                  {p.proposal.kind === 'file' && architecture && architecture.components.length > 0 && (
                    <select
                      className="reassign-select"
                      value={reassign[p.id] ?? p.proposal.component}
                      onChange={(e) => setReassign((r) => ({ ...r, [p.id]: e.target.value }))}
                    >
                      {architecture.components.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.id}
                        </option>
                      ))}
                    </select>
                  )}
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
                      <button
                        className="approve"
                        onClick={() => (p.proposal.kind === 'file' ? approveFile(p) : decide(p.id, true))}
                      >
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
            <Canvas architecture={architecture} pending={projectPending} />
          </>
        ) : (
          <div className="empty-state">Select a project to open its architecture</div>
        )}
      </main>

      {showConnectMcp && <ConnectMcpPanel bridge={bridge} onClose={() => setShowConnectMcp(false)} />}
    </div>
  )
}
