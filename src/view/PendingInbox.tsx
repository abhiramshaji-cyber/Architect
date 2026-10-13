import { useState } from 'react'
import type { Pending } from '../../shared/types'
import { hasCycle } from '../model/layout'
import { decide, reassignFile, useProject } from '../model/store'

function describe(p: Pending): string {
  const proposal = p.proposal
  if (proposal.kind === 'component') return `new component: ${proposal.id}`
  if (proposal.kind === 'remove_component') return `remove component: ${proposal.id}`
  if (proposal.kind === 'edge') return `new edge: ${proposal.from} → ${proposal.to}`
  if (proposal.kind === 'package') return `new package: ${proposal.name} on ${proposal.component}`
  if (proposal.kind === 'contract') return 'first architect.md, drafted by Claude'
  return `new file: ${proposal.path}`
}

export default function PendingInbox() {
  const { pending, architecture, reassign } = useProject()
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const settle = (id: string, approved: boolean, why?: string, component?: string) => {
    decide(id, approved, why, component)
    setRejecting(null)
    setReason('')
  }

  const approve = (p: Pending) => {
    if (p.proposal.kind !== 'file') return settle(p.id, true)
    settle(p.id, true, undefined, reassign[p.id] ?? p.proposal.component)
  }

  return (
    <div className="rail-section inbox">
      <div className="rail-head">
        <h2>
          Inbox
          {pending.length > 0 && <span className="rail-count">{pending.length}</span>}
        </h2>
      </div>
      <ul className="pending-list">
        {pending.map((p) => {
          const cycle =
            architecture && p.proposal.kind === 'edge'
              ? hasCycle(architecture.edges, p.proposal.from, p.proposal.to)
              : false
          return (
            <li key={p.id} className={`pending-item${p.proposal.kind === 'remove_component' ? ' pending-removal' : ''}`}>
              <div className="pending-summary">{describe(p)}</div>
              <div className="pending-rationale">{p.rationale}</div>
              {p.proposal.kind === 'contract' && <pre className="pending-contract">{p.proposal.markdown}</pre>}
              {cycle && <div className="pending-cycle">Creates a cycle</div>}
              {p.proposal.kind === 'file' && architecture && architecture.components.length > 0 && (
                <select
                  className="reassign-select"
                  value={reassign[p.id] ?? p.proposal.component}
                  onChange={(e) => reassignFile(p.id, e.target.value)}
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
                    placeholder="Reason"
                  />
                  <button onClick={() => settle(p.id, false, reason)}>Send</button>
                  <button className="ghost" onClick={() => setRejecting(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="pending-actions">
                  <button className="primary" onClick={() => approve(p)}>
                    Approve
                  </button>
                  <button onClick={() => setRejecting(p.id)}>Reject</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
