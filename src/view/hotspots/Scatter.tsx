import { memo, useMemo } from 'react'
import type { Hotspot, Most } from './rank'
import { axis } from './scale'

const W = 640
const H = 320
const PAD = { left: 48, right: 16, top: 12, bottom: 36 }

type ScatterProps = { items: Hotspot[]; most: Most; top: Set<string>; hovered: string | null; onHover: (key: string | null) => void; onPick: (item: Hotspot) => void }

export default memo(function Scatter({ items, most, top, hovered, onHover, onPick }: ScatterProps) {
  const { x, y } = useMemo(() => ({ x: axis(most.lines), y: axis(most.commits) }), [most])
  const px = (lines: number) => PAD.left + x.at(lines) * (W - PAD.left - PAD.right)
  const py = (commits: number) => H - PAD.bottom - y.at(commits) * (H - PAD.top - PAD.bottom)
  const drawn = useMemo(() => [...items].reverse(), [items])

  return (
    <svg className="hs-plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Lines against commits" onMouseLeave={() => onHover(null)}>
      {x.ticks.map((tick) => (
        <g key={`x${tick}`} className="hs-tick">
          <line x1={px(tick)} x2={px(tick)} y1={PAD.top} y2={H - PAD.bottom} />
          <text x={px(tick)} y={H - PAD.bottom + 14} textAnchor="middle">{tick}</text>
        </g>
      ))}
      {y.ticks.map((tick) => (
        <g key={`y${tick}`} className="hs-tick">
          <line x1={PAD.left} x2={W - PAD.right} y1={py(tick)} y2={py(tick)} />
          <text x={PAD.left - 6} y={py(tick) + 4} textAnchor="end">{tick}</text>
        </g>
      ))}
      <text className="hs-axis" x={(W + PAD.left) / 2} y={H - 4} textAnchor="middle">lines (log scale)</text>
      <text className="hs-axis" transform={`translate(12 ${(H - PAD.bottom) / 2}) rotate(-90)`} textAnchor="middle">commits (log scale)</text>
      {drawn.map((item) => (
        <circle
          key={item.key}
          className={item.key === hovered ? 'hs-dot hovered' : top.has(item.key) ? 'hs-dot top' : 'hs-dot'}
          cx={px(item.lines)}
          cy={py(item.commits)}
          r={item.key === hovered ? 6 : 4}
          onMouseEnter={() => onHover(item.key)}
          onClick={() => onPick(item)}
        />
      ))}
    </svg>
  )
})
