import { describe, expect, it } from 'vitest'
import type { FunctionFacts } from '../../shared/types'
import { bucketed, importanceOf, pageRank, scoreOf } from './importance'

const fact = (over: Partial<FunctionFacts> = {}): FunctionFacts => ({
  file: 'a.ts',
  name: 'x',
  line: 1,
  lines: 1,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: null,
  untraced: null,
  ...over,
})

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)

describe('pageRank', () => {
  it('returns nothing for no functions and everything for one', () => {
    expect(pageRank([])).toEqual([])
    expect(pageRank([[]])[0]).toBeCloseTo(1)
  })

  it('settles on a cycle and shares it evenly', () => {
    const ranks = pageRank([[1], [2], [0]])
    expect(sum(ranks)).toBeCloseTo(1)
    for (const rank of ranks) expect(rank).toBeCloseTo(1 / 3)
  })

  it('lifts what many others depend on, directly or through a chain', () => {
    const ranks = pageRank([[3], [3], [3], [4], [], []])
    expect(sum(ranks)).toBeCloseTo(1)
    expect(ranks[4]).toBeGreaterThan(ranks[3] ?? 0)
    expect(ranks[3]).toBeGreaterThan(ranks[0] ?? 0)
    expect(ranks[5]).toBeCloseTo(ranks[0] ?? 0)
  })
})

describe('bucketed', () => {
  it('handles an empty project, a single function and an all tied project', () => {
    expect(bucketed([])).toEqual([])
    expect(bucketed([7])).toEqual([3])
    expect(bucketed([2, 2, 2, 2])).toEqual([3, 3, 3, 3])
  })

  it('spreads a project across all five levels by its own quantiles', () => {
    const levels = bucketed(Array.from({ length: 100 }, (_, i) => i))
    expect(levels.filter((l) => l === 1)).toHaveLength(20)
    expect(levels.filter((l) => l === 2)).toHaveLength(30)
    expect(levels.filter((l) => l === 3)).toHaveLength(30)
    expect(levels.filter((l) => l === 4)).toHaveLength(15)
    expect(levels.filter((l) => l === 5)).toHaveLength(5)
  })

  it('gives tied scores the same level, even with float noise', () => {
    const levels = bucketed([0.1 + 0.2, 0.3, 5, 9, 0])
    expect(levels[0]).toBe(levels[1])
    expect(levels[3]).toBeGreaterThan(levels[2] ?? 0)
  })
})

describe('importanceOf', () => {
  it('ranks the shared core and the starting point above a loose leaf', () => {
    const edges = [[1], [2], [], [2], []]
    const facts = [
      fact({ name: 'main', entry: { reason: 'bin', file: 'cli.ts' } }),
      fact({ name: 'mid', fanIn: 1 }),
      fact({ name: 'core', fanIn: 2, exported: true }),
      fact({ name: 'other', fanOut: 1 }),
      fact({ name: 'leaf' }),
    ]
    const [main, , core, , leaf] = importanceOf(edges, facts)
    expect(core).toBeGreaterThan(leaf ?? 0)
    expect(main).toBeGreaterThan(leaf ?? 0)
  })

  it('treats any function with a starting point reason as a root, and exported as a bonus', () => {
    const tool = { reason: 'mcpTool', file: 'mcp.ts' } as const
    expect(scoreOf(fact({ entry: tool }), 1)).toBeGreaterThan(scoreOf(fact(), 1))
    expect(scoreOf(fact({ entry: tool, fanIn: 1 }), 1)).toBeGreaterThan(scoreOf(fact({ fanIn: 1 }), 1))
    expect(scoreOf(fact({ exported: true }), 1)).toBeGreaterThan(scoreOf(fact(), 1))
  })
})
