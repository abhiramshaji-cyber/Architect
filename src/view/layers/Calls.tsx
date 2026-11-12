import type { LayerCell } from '../../../shared/types'

export const STATUS_LABEL: Record<LayerCell['status'], string> = {
  allowed: 'allowed',
  forbidden: 'forbidden',
  undrawn: 'undrawn',
  stale: 'stale edge',
  free: 'calls',
}

type CallsProps = { cell: LayerCell; onOpen: (file: string, line: number) => void; onClose: () => void }

function sortedCalls(cell: LayerCell): LayerCell['calls'] {
  return [...cell.calls].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.target.localeCompare(b.target) || a.targetLine - b.targetLine,
  )
}

function reasonOf(cell: LayerCell): string | null {
  const verdict = cell.verdict
  if (verdict?.status === 'forbidden') return verdict.reason
  if (verdict?.status === 'cycle') return `cycle: ${verdict.path.join(' → ')}`
  if (verdict?.status === 'unknown-component') return `unknown: ${verdict.ids.join(', ')}`
  return null
}

export default function Calls({ cell, onOpen, onClose }: CallsProps) {
  const reason = reasonOf(cell)

  return (
    <aside className="layers-calls" aria-label={`${cell.from} → ${cell.to}`}>
      <header>
        <h3>
          {cell.from} → {cell.to}
        </h3>
        <span className={`layers-tag ${cell.status}`}>{STATUS_LABEL[cell.status]}</span>
        <span className="layers-count">{cell.calls.length}</span>
        <button type="button" className="layers-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {reason && <p className="layers-reason">{reason}</p>}
      <ul>
        {sortedCalls(cell).map((call, at) => (
          <li key={at}>
            <button type="button" onClick={() => onOpen(call.file, call.line)}>
              <span className="layers-fn">{call.fn}</span>
              <span className="layers-loc">
                {call.file}:{call.line}
              </span>
            </button>
            <span className="layers-arrow">→</span>
            <button type="button" onClick={() => onOpen(call.target, call.targetLine)}>
              <span className="layers-fn">{call.targetFn}</span>
              <span className="layers-loc">
                {call.target}:{call.targetLine}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
