import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Architecture, Edit, EditSummary, McpBridgeInfo, Pending } from '../shared/types'
import Canvas from './Canvas'
import ConnectMcpPanel from './ConnectMcpPanel'
import { addComponent, type OpResult } from './edit-ops'
import { folderName, hasCycle } from './layout'

type ProjectSummary = { root: string; title: string }

function placeholderId(a: Architecture): string {
  const taken = new Set(a.components.map((c) => c.id))
  let n = 1
  while (taken.has(`component${n}`)) n++
  return `component${n}`
}

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
  const [showConnectMcp, setShowConnectMcp] = useState(false)
  const [bridge, setBridge] = useState<McpBridgeInfo | null>(null)
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'dark')
  const [edits, setEdits] = useState<EditSummary[]>([])
  const [draft, setDraft] = useState<Edit | null>(null)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const flipTheme = useCallback(() => {
    const next = theme === 'light' ? 'dark' : 'light'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('theme', next)
    } catch {}
    setTheme(next)
  }, [theme])

  const discardOk = useCallback(
    () => !dirty || confirm('This edit has unsaved changes. Discard them?'),
    [dirty]
  )

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), error: true })
    } finally {
      setBusy(false)
    }
  }, [])

  const openProject = useCallback(
    (root: string) => {
      if (busy || !discardOk()) return
      window.architect.open(root).then((a) => {
        setArchitecture(a)
        setCurrentRoot(root)
        setDraft(null)
        setDirty(false)
        setMessage(null)
      })
    },
    [busy, discardOk]
  )

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

  useEffect(() => {
    if (!currentRoot) {
      setEdits([])
      return
    }
    let live = true
    window.architect
      .edits(currentRoot)
      .then((list) => {
        if (live) setEdits(list)
      })
      .catch((err: unknown) => {
        if (live) setMessage({ text: err instanceof Error ? err.message : String(err), error: true })
      })
    return () => {
      live = false
    }
  }, [currentRoot])

  const refreshEdits = useCallback(async (root: string) => {
    setEdits(await window.architect.edits(root))
  }, [])

  const newEdit = useCallback(() => {
    if (!currentRoot || !architecture || busy || !discardOk()) return
    void run(async () => {
      const created = await window.architect.createEdit(currentRoot, architecture)
      setDraft(created)
      setDirty(false)
      setMessage(null)
      await refreshEdits(currentRoot)
    })
  }, [currentRoot, architecture, busy, discardOk, run, refreshEdits])

  const openEdit = useCallback(
    (id: string) => {
      if (!currentRoot || busy || !discardOk()) return
      void run(async () => {
        const opened = await window.architect.edit(currentRoot, id)
        setDraft(opened)
        setDirty(false)
        setMessage(null)
      })
    },
    [currentRoot, busy, discardOk, run]
  )

  const applyEdit = useCallback(
    (op: (a: Architecture) => OpResult) => {
      if (!draft || draft.status === 'handed') return
      const result = op(draft.architecture)
      if (!result.ok) {
        setMessage({ text: result.error, error: true })
        return
      }
      setDraft({ ...draft, architecture: result.architecture })
      setDirty(true)
      setMessage(null)
    },
    [draft]
  )

  const saveEdit = useCallback(() => {
    if (!currentRoot || !draft || draft.status === 'handed' || busy) return
    void run(async () => {
      const saved = await window.architect.updateEdit(currentRoot, draft.id, draft.architecture)
      setDraft(saved)
      setDirty(false)
      setMessage({ text: 'Saved', error: false })
      await refreshEdits(currentRoot)
    })
  }, [currentRoot, draft, busy, run, refreshEdits])

  const handToClaude = useCallback(() => {
    if (!currentRoot || !draft || draft.status === 'handed' || busy) return
    const warning = dirty ? ' Unsaved changes will not be included.' : ''
    if (!confirm(`Hand edit ${draft.id} to Claude? It becomes permanently read only.${warning}`)) return
    void run(async () => {
      const handed = await window.architect.handEdit(currentRoot, draft.id)
      setDraft(handed)
      setDirty(false)
      setMessage({ text: 'Handed to Claude. This edit is now read only.', error: false })
      await refreshEdits(currentRoot)
    })
  }, [currentRoot, draft, dirty, busy, run, refreshEdits])

  const removeEdit = useCallback(() => {
    if (!currentRoot || !draft || busy) return
    if (!confirm(`Delete edit ${draft.id}? This cannot be undone.`)) return
    void run(async () => {
      await window.architect.deleteEdit(currentRoot, draft.id)
      setDraft(null)
      setDirty(false)
      setMessage(null)
      await refreshEdits(currentRoot)
    })
  }, [currentRoot, draft, busy, run, refreshEdits])

  const closeEdit = useCallback(() => {
    if (busy || !discardOk()) return
    setDraft(null)
    setDirty(false)
    setMessage(null)
  }, [busy, discardOk])

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

  const shown = draft ? draft.architecture : architecture

  const openConnectMcp = useCallback(() => {
    setShowConnectMcp(true)
    setBridge(null)
    window.architect.mcpBridgeInfo().then(setBridge)
  }, [])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-section">
          <div className="sidebar-header">
            <h1>Architect</h1>
            <button
              className="theme-toggle"
              onClick={flipTheme}
              aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {theme === 'light' ? (
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <path
                    d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
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
              return (
                <li key={p.root}>
                  <button
                    className={p.root === currentRoot ? 'project active' : 'project'}
                    onClick={() => openProject(p.root)}
                    disabled={busy}
                  >
                    <span className="project-folder">{folder}</span>
                    {p.title !== folder && <span className="project-title">{p.title}</span>}
                  </button>
                </li>
              )
            })}
            {projects.length === 0 && <li className="empty">No projects yet</li>}
          </ul>
          <button className="sidebar-action" onClick={openConnectMcp}>
            Connect MCP
          </button>
          <button className="sidebar-action" onClick={flipTheme}>
            {theme === 'light' ? 'Dark mode' : 'Light mode'}
          </button>
        </div>

        <div className="sidebar-section">
          <h2>Edits</h2>
          <button className="sidebar-action" onClick={newEdit} disabled={!currentRoot || !architecture || busy}>
            New edit
          </button>
          <ul className="edits-list">
            {edits.map((e) => (
              <li key={e.id}>
                <button
                  className={draft && draft.id === e.id ? 'edit-item active' : 'edit-item'}
                  onClick={() => openEdit(e.id)}
                  disabled={e.error !== undefined || busy}
                >
                  <span>{e.title === '' ? e.id : e.title}</span>
                  <span className={`edit-status ${e.status}`}>{e.status}</span>
                </button>
                {e.error !== undefined && <div className="edit-error">{e.error}</div>}
              </li>
            ))}
            {edits.length === 0 && <li className="empty">No edits yet</li>}
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
        {shown ? (
          <>
            <header className="canvas-header">
              <h2>{shown.title}</h2>
              {currentRoot && <p className="canvas-path">{currentRoot}</p>}
              <p>{shown.summary}</p>
            </header>
            {draft && (
              <div className="edit-bar">
                <div className="edit-bar-label">
                  Editing {draft.id} · {draft.status === 'handed' ? 'handed, read only' : 'draft'}
                  {dirty && ' · unsaved changes'}
                </div>
                <div className="edit-bar-actions">
                  {draft.status === 'draft' && (
                    <>
                      <button
                        className="ghost"
                        onClick={() => applyEdit((a) => addComponent(a, placeholderId(a)))}
                        disabled={busy}
                      >
                        Add component
                      </button>
                      <button className="primary" onClick={saveEdit} disabled={busy}>
                        Save
                      </button>
                      <button className="hand" onClick={handToClaude} disabled={busy}>
                        Hand to Claude
                      </button>
                    </>
                  )}
                  <button className="ghost" onClick={closeEdit} disabled={busy}>
                    Close
                  </button>
                  <button className="ghost" onClick={removeEdit} disabled={busy}>
                    Delete
                  </button>
                </div>
                {message && (
                  <div className={message.error ? 'edit-bar-message error' : 'edit-bar-message'}>{message.text}</div>
                )}
              </div>
            )}
            <Canvas
              key={draft ? `${currentRoot}:${draft.id}:${draft.status}` : currentRoot}
              architecture={shown}
              pending={draft ? [] : projectPending}
              theme={theme}
              onEdit={draft && draft.status === 'draft' ? applyEdit : undefined}
            />
          </>
        ) : (
          <div className="empty-state">Select a project to open its architecture</div>
        )}
      </main>

      {showConnectMcp && <ConnectMcpPanel bridge={bridge} onClose={() => setShowConnectMcp(false)} />}
    </div>
  )
}
