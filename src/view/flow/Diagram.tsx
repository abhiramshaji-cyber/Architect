import { useMemo } from 'react'
import type { Flow, FlowStep } from '../../../shared/types'
import { BAR, HEAD, LANE, layoutOf, type Arrow } from './layout'

type DiagramProps = { flow: Flow; onOpen: (file: string, line: number) => void; onExpand: (key: string) => void }

const LOOP = 26

function labelOf(step: FlowStep): string {
  const times = step.times > 1 ? ` ×${step.times}` : ''
  const ipc = step.ipc === undefined ? '' : ' (ipc)'
  const mark = step.mark === 'cycle' ? ' ↻ cycle' : step.mark === 'repeat' ? ' ↑ drawn above' : ''
  return `${step.callee}${ipc}${times}${mark}`
}

function titleOf(step: FlowStep): string {
  const lines = [`${step.file}:${step.line} calls ${step.callee} at ${step.target}:${step.targetLine}`]
  if (step.ipc !== undefined) lines.push(`over ipc channel ${step.ipc}`)
  if (step.forbidden !== undefined) lines.push(`forbidden by architect.md: ${step.forbidden}`)
  return lines.join('\n')
}

function pathOf({ x1, x2, y, self }: Arrow): string {
  if (!self) return `M ${x1} ${y} H ${x2}`
  const out = Math.max(x1, x2) + LOOP
  return `M ${x1} ${y - 6} H ${out} V ${y + 6} H ${x2}`
}

function headOf({ x1, x2, y, self }: Arrow): string {
  const tip = x2
  const back = self || x2 < x1 ? tip + 7 : tip - 7
  const at = self ? y + 6 : y
  return `${tip},${at} ${back},${at - 4} ${back},${at + 4}`
}

export default function Diagram({ flow, onOpen, onExpand }: DiagramProps) {
  const drawn = useMemo(() => layoutOf(flow), [flow])

  return (
    <svg className="flow-svg" width={drawn.width} height={drawn.height} role="img" aria-label={`Call flow from ${flow.start}`}>
      {drawn.lanes.map((lane) => (
        <g key={lane.name} className="flow-lane">
          <line x1={lane.x} x2={lane.x} y1={HEAD} y2={drawn.height} />
          <rect x={lane.x - LANE / 2 + 8} y={4} width={LANE - 16} height={HEAD - 12} rx={4} />
          <text x={lane.x} y={HEAD / 2 + 2} textAnchor="middle">
            <title>{lane.name}</title>
            {lane.name}
          </text>
        </g>
      ))}

      {drawn.bars.map((bar, at) => (
        <rect key={at} className="flow-active" x={bar.x - BAR / 2} y={bar.y1} width={BAR} height={Math.max(4, bar.y2 - bar.y1)} />
      ))}

      {drawn.arrows.map((arrow) => {
        const { step } = arrow
        const kind = [step.forbidden !== undefined && 'forbidden', step.ipc !== undefined && 'ipc', step.mark]
          .filter(Boolean)
          .join(' ')
        const left = arrow.self ? arrow.x1 + LOOP + 4 : Math.min(arrow.x1, arrow.x2) + 6
        const plus = arrow.self || arrow.x2 < arrow.x1 ? arrow.x2 - 22 : arrow.x2 + 4
        return (
          <g key={arrow.at} className={`flow-call ${kind}`}>
            <g
              role="button"
              tabIndex={0}
              onClick={() => onOpen(step.file, step.line)}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(step.file, step.line)}
            >
              <title>{titleOf(step)}</title>
              <path className="flow-hit" d={pathOf(arrow)} />
              <path className="flow-line" d={pathOf(arrow)} />
              <polygon className="flow-head" points={headOf(arrow)} />
              <text className="flow-label" x={left} y={arrow.y - (arrow.self ? 10 : 5)}>
                {labelOf(step)}
              </text>
            </g>
            {step.more && (
              <g
                role="button"
                tabIndex={0}
                className="flow-more"
                onClick={() => onExpand(step.key)}
                onKeyDown={(e) => e.key === 'Enter' && onExpand(step.key)}
              >
                <title>{`Expand the calls inside ${step.callee}`}</title>
                <rect x={plus} y={arrow.y - 8} width={18} height={16} rx={3} />
                <text x={plus + 9} y={arrow.y + 4} textAnchor="middle">
                  +
                </text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}
