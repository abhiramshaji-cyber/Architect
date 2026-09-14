import { statusOf, type NodeData } from './layout'

type InspectorProps = {
  node: NodeData
  onClose: () => void
}

export default function Inspector({ node, onClose }: InspectorProps) {
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
