import { useMemo } from 'react'
import type { LayerCell, Layers } from '../../../shared/types'
import { gridOf } from './grid'

const place = (row: number, col: number, size = 1) => ({ gridRow: `${row} / span ${size}`, gridColumn: `${col} / span ${size}` })

type MatrixProps = { layers: Layers; picked: LayerCell | null; onPick: (cell: LayerCell) => void }

export default function Matrix({ layers, picked, onPick }: MatrixProps) {
  const { rows } = layers
  const { spans, cellAt } = useMemo(() => gridOf(layers), [layers])

  return (
    <div className="layers-grid" role="grid" style={{ gridTemplateColumns: `max-content repeat(${rows.length}, var(--layer-cell))` }}>
      <div className="layers-corner" style={place(1, 1)} />
      {rows.map((col, at) => (
        <div key={col.id} className="layers-col" title={col.id} style={place(1, at + 2)}>
          {at + 1}
        </div>
      ))}

      {rows.map((row, y) => (
        <div key={row.id} className="layers-row" role="row" data-step={y > 0 && rows[y - 1]?.level !== row.level ? '' : undefined}>
          <div className="layers-name" title={row.id} style={place(y + 2, 1)}>
            <span className="layers-level">L{row.level}</span>
            <span className="layers-id">{row.id}</span>
            <span className="layers-at">{y + 1}</span>
          </div>
          {rows.map((col, x) => {
            const cell = cellAt(row.id, col.id)
            const spot = place(y + 2, x + 2)
            if (x === y) return <div key={col.id} className="layers-cell self" style={spot} />
            if (!cell) return <div key={col.id} className="layers-cell" style={spot} />
            return (
              <button
                key={col.id}
                type="button"
                style={spot}
                className={`layers-cell ${cell.status}${cell === picked ? ' picked' : ''}`}
                title={`${row.id} → ${col.id}: ${cell.calls.length} ${cell.status}`}
                onClick={() => onPick(cell)}
              >
                {cell.calls.length}
              </button>
            )
          })}
        </div>
      ))}

      {spans.map(({ start, size }) => (
        <div key={start} className="layers-cycle" style={place(start + 2, start + 2, size)} />
      ))}
    </div>
  )
}
