import type { Flow, FlowStep } from '../../../shared/types'

export const LANE = 220
export const ROW = 34
export const HEAD = 44
export const BAR = 8

export type Lane = { name: string; x: number }
export type Arrow = { step: FlowStep; at: number; y: number; x1: number; x2: number; self: boolean }
export type Bar = { x: number; y1: number; y2: number }
export type Drawn = { width: number; height: number; lanes: Lane[]; arrows: Arrow[]; bars: Bar[] }

const rowY = (at: number) => HEAD + ROW * (at + 1)

function lastBelow(steps: FlowStep[], at: number): number {
  const depth = steps[at]?.depth ?? 0
  let end = at
  while ((steps[end + 1]?.depth ?? -1) > depth) end += 1
  return end
}

export function layoutOf(flow: Flow): Drawn {
  const center = new Map(flow.lanes.map((name, at) => [name, LANE * at + LANE / 2]))
  const laneX = (name: string) => center.get(name) ?? 0
  const steps = flow.steps
  const height = rowY(steps.length) + ROW / 2

  const open: { lane: string; end: number; x: number }[] = [{ lane: flow.lane, end: steps.length - 1, x: laneX(flow.lane) }]
  const bars: Bar[] = [{ x: laneX(flow.lane), y1: HEAD + ROW / 2, y2: height - ROW / 2 }]
  const arrows: Arrow[] = []

  steps.forEach((step, at) => {
    while (open.length > 1 && (open[open.length - 1]?.end ?? at) < at) open.pop()
    const y = rowY(at)
    const from = open[open.length - 1]?.x ?? laneX(step.from)
    const self = step.from === step.to
    const expanded = (steps[at + 1]?.depth ?? -1) > step.depth
    let to = self && !expanded ? from : laneX(step.to)

    if (expanded) {
      const end = lastBelow(steps, at)
      to += open.filter((bar) => bar.lane === step.to).length * (BAR / 2)
      open.push({ lane: step.to, end, x: to })
      bars.push({ x: to, y1: y, y2: rowY(end) + ROW / 2 })
    }

    const right = self || to >= from
    arrows.push({ step, at, y, x1: from + (right ? BAR / 2 : -BAR / 2), x2: to + (right && !self ? -BAR / 2 : BAR / 2), self })
  })

  const lanes = flow.lanes.map((name) => ({ name, x: laneX(name) }))
  return { width: Math.max(LANE, LANE * flow.lanes.length), height, lanes, arrows, bars }
}
