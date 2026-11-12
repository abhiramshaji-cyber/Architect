import { describe, expect, it } from 'vitest'
import type { Flow, FlowStep } from '../../../shared/types'
import { BAR, HEAD, LANE, layoutOf, ROW } from './layout'

const step = (from: string, to: string, depth: number): FlowStep => ({
  key: `${to}${depth}`,
  from,
  to,
  file: 'f.ts',
  line: 1,
  callee: 'c',
  target: 't.ts',
  targetLine: 1,
  depth,
  lines: [1],
})

const flowOf = (lanes: string[], steps: FlowStep[]): Flow => ({
  start: 's',
  file: 'f.ts',
  line: 1,
  entry: { reason: 'mcpTool', file: 'f.ts' },
  lane: lanes[0] ?? '',
  lanes,
  steps,
  depth: 3,
  contract: false,
  cut: false,
})

describe('layoutOf', () => {
  it('opens an activation bar for each expanded call and closes it after its last nested call', () => {
    const drawn = layoutOf(flowOf(['a', 'b'], [step('a', 'b', 0), step('b', 'a', 1), step('a', 'b', 0)]))
    const a = LANE / 2
    const b = LANE + LANE / 2
    expect(drawn.width).toBe(2 * LANE)
    expect(drawn.bars).toEqual([
      { x: a, y1: HEAD + ROW / 2, y2: HEAD + ROW * 4 },
      { x: b, y1: HEAD + ROW, y2: HEAD + ROW * 2 + ROW / 2 },
    ])
    expect(drawn.arrows.map(({ x1, x2 }) => [x1, x2])).toEqual([
      [a + BAR / 2, b - BAR / 2],
      [b - BAR / 2, a + BAR / 2],
      [a + BAR / 2, b - BAR / 2],
    ])
  })

  it('nests a bar beside its caller on the same lane and draws a call to itself as a loop', () => {
    const drawn = layoutOf(flowOf(['a'], [step('a', 'a', 0), step('a', 'a', 1)]))
    const a = LANE / 2
    expect(drawn.bars[1]).toMatchObject({ x: a + BAR / 2 })
    expect(drawn.arrows.map(({ x1, x2, self }) => [x1, x2, self])).toEqual([
      [a + BAR / 2, a + BAR, true],
      [a + BAR, a + BAR / 2 + BAR / 2, true],
    ])
  })

  it('draws only the starting lifeline for a flow with no calls', () => {
    const drawn = layoutOf(flowOf(['a'], []))
    expect(drawn.arrows).toEqual([])
    expect(drawn.bars).toHaveLength(1)
    expect(drawn.width).toBe(LANE)
  })
})
