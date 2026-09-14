import { useState } from 'react'

import type { Architecture } from '../shared/types'
import { removeComponent, renameComponent, setOwns, setPurpose, type OpResult } from './edit-ops'
import { statusOf, type NodeData } from './layout'

type InspectorProps = {
  node: NodeData
  onClose: () => void
  onEdit?: (op: (a: Architecture) => OpResult) => void
}

export default function Inspector({ node, onClose, onEdit }: InspectorProps) {
  const [pass, setPass] = useState(0)

  const edit = node.kind === 'component' && !node.ghost ? onEdit : undefined
  const owned = node.owns.join('\n')

  const commit = (op: (a: Architecture) => OpResult) => {
    if (!edit) return
    edit(op)
    setPass((p) => p + 1)
  }

  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  const drop = () => {
    if (!confirm(`Delete "${node.label}" and every edge touching it?`)) return
    commit((a) => removeComponent(a, node.label))
  }

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div className="inspector-title">
          <span className="inspector-id">{node.label}</span>
          <span className="inspector-status">{statusOf(node)}</span>
        </div>
        <button className="inspector-close" onClick={onClose} aria-label="Close inspector">
          ×
        </button>
      </div>

      {edit ? (
        <section className="inspector-section">
          <div className="inspector-field">
            <label htmlFor="inspector-id-input">Component</label>
            <input
              id="inspector-id-input"
              key={`id-${node.label}-${pass}`}
              className="inspector-input"
              defaultValue={node.label}
              onKeyDown={blurOnEnter}
              onBlur={(e) => {
                const value = e.target.value
                if (value === node.label) return
                commit((a) => renameComponent(a, node.label, value))
              }}
            />
          </div>

          <div className="inspector-field">
            <label htmlFor="inspector-purpose-input">Purpose</label>
            <input
              id="inspector-purpose-input"
              key={`purpose-${node.label}-${node.purpose}-${pass}`}
              className="inspector-input"
              defaultValue={node.purpose}
              onKeyDown={blurOnEnter}
              onBlur={(e) => {
                const value = e.target.value
                if (value === node.purpose) return
                commit((a) => setPurpose(a, node.label, value))
              }}
            />
          </div>

          <div className="inspector-field">
            <label htmlFor="inspector-owns-input">Owns</label>
            <textarea
              id="inspector-owns-input"
              key={`owns-${node.label}-${owned}-${pass}`}
              className="inspector-textarea"
              rows={4}
              defaultValue={owned}
              onBlur={(e) => {
                const value = e.target.value
                if (value === owned) return
                commit((a) => setOwns(a, node.label, value.split('\n')))
              }}
            />
          </div>

          <button className="inspector-danger" onClick={drop}>
            Delete component
          </button>
        </section>
      ) : (
        <>
          {node.purpose && (
            <section className="inspector-section">
              <h3>{node.kind === 'file' ? 'Path' : 'Purpose'}</h3>
              <p className="inspector-purpose">{node.purpose}</p>
            </section>
          )}

          {node.owns.length > 0 && (
            <section className="inspector-section">
              <h3>Owns</h3>
              <ul className="inspector-owns">
                {node.owns.map((glob) => (
                  <li key={glob}>{glob}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {node.badges.length > 0 && (
        <section className="inspector-section">
          <h3>Proposed packages</h3>
          <div className="node-badges">
            {node.badges.map((b) => (
              <span key={b} className="badge">
                {b}
              </span>
            ))}
          </div>
        </section>
      )}
    </aside>
  )
}
