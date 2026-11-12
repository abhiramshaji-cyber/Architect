import { describe, expect, it } from 'vitest'
import type { Entry, FunctionRow } from '../../shared/types'
import { treeOf } from './tree'

const BIN: Entry = { reason: 'bin', file: 'cli.ts' }

const TOOL: Entry = { reason: 'mcpTool', file: 'mcp.ts' }

const row = (name: string, over: Partial<FunctionRow> = {}): FunctionRow => ({
  file: 'a.ts',
  name,
  line: 1,
  lines: 1,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: null,
  untraced: null,
  importance: 1,
  ...over,
})

function graph(specs: [string, number[], Partial<FunctionRow>?][]) {
  const edges = specs.map(([, out]) => out)
  const fanIn = specs.map((_, at) => edges.filter((out) => out.includes(at)).length)
  const rows = specs.map(([name, out, over], at) => row(name, { fanIn: fanIn[at], fanOut: out.length, ...over }))
  return treeOf(rows, edges)
}

const placed = (tree: ReturnType<typeof treeOf>) =>
  [...tree.starts, ...tree.unknown, ...tree.unreached, ...tree.children.flat()].sort((a, b) => a - b)

describe('treeOf', () => {
  it('handles an empty project and a single function', () => {
    expect(treeOf([], [])).toEqual({
      starts: [],
      groups: [],
      unknown: [],
      unreached: [],
      children: [],
      also: [],
    })
    expect(graph([['main', [], { entry: BIN }]])).toEqual({
      starts: [0],
      groups: [{ file: 'cli.ts', reason: 'bin', members: [0] }],
      unknown: [],
      unreached: [],
      children: [[]],
      also: [0],
    })
    expect(graph([['lonely', []]])).toEqual({
      starts: [],
      groups: [],
      unknown: [],
      unreached: [0],
      children: [[]],
      also: [0],
    })
  })

  it('roots only at functions with a named reason, most important first, even when something calls them', () => {
    const tree = graph([
      ['page', [2], { entry: BIN, importance: 2 }],
      ['layout', [2], { entry: BIN, importance: 4 }],
      ['shared', []],
      ['tool', [], { entry: TOOL, importance: 3 }],
      ['register', [3]],
      ['orphan', []],
    ])
    expect(tree.starts).toEqual([1, 3, 0])
    expect(tree.children[1]).toEqual([2])
    expect(tree.children[0]).toEqual([])
    expect(tree.also[2]).toBe(1)
    expect(tree.unreached).toEqual([5, 4])
    expect(tree.children[4]).toEqual([])
    expect(tree.also[3]).toBe(1)
  })

  it('groups starting points by reason and the file that declares it, in rank order', () => {
    const tree = graph([
      ['a', [], { entry: TOOL, importance: 2 }],
      ['b', [], { entry: BIN, importance: 5 }],
      ['c', [], { entry: TOOL, importance: 4 }],
      ['d', [], { entry: { reason: 'mcpTool', file: 'other.ts' } }],
    ])
    expect(tree.groups).toEqual([
      { file: 'cli.ts', reason: 'bin', members: [1] },
      { file: 'mcp.ts', reason: 'mcpTool', members: [2, 0] },
      { file: 'other.ts', reason: 'mcpTool', members: [3] },
    ])
  })

  it('never makes an uncalled function without a reason a starting point, but lifts it when scoped', () => {
    const rows = [row('orphan'), row('kid', { fanIn: 1 })]
    expect(treeOf(rows, [[1], []]).starts).toEqual([])
    expect(treeOf(rows, [[1], []]).unreached).toEqual([0])
    expect(treeOf(rows, [[1], []], true)).toMatchObject({ starts: [0], groups: [], unknown: [], unreached: [] })
  })

  it('places every function exactly once, under its shallowest and most important caller', () => {
    const tree = graph([
      ['main', [1, 2], { entry: BIN }],
      ['weak', [3], { importance: 1 }],
      ['strong', [3], { importance: 5 }],
      ['deep', [4]],
      ['leaf', [3]],
    ])
    expect(placed(tree)).toEqual([0, 1, 2, 3, 4])
    expect(tree.children[0]).toEqual([2, 1])
    expect(tree.children[2]).toEqual([3])
    expect(tree.children[1]).toEqual([])
    expect(tree.children[4]).toEqual([])
    expect(tree.also[3]).toBe(2)
  })

  it('cuts cycles, including a project where every function is in one', () => {
    const tree = graph([
      ['a', [1], { importance: 2 }],
      ['b', [2], { importance: 3 }],
      ['c', [0], { importance: 1 }],
    ])
    expect(tree.starts).toEqual([])
    expect(tree.unreached).toEqual([1])
    expect(tree.children[1]).toEqual([2])
    expect(tree.children[2]).toEqual([0])
    expect(tree.also).toEqual([0, 1, 0])
  })

  it('buckets unreached code with its own callees beneath it, most important first', () => {
    const tree = graph([
      ['main', [], { entry: BIN }],
      ['dead', [2], { importance: 1 }],
      ['deadHelper', []],
      ['loopA', [4], { importance: 5 }],
      ['loopB', [3]],
    ])
    expect(tree.starts).toEqual([0])
    expect(tree.unreached).toEqual([3, 1])
    expect(tree.children[1]).toEqual([2])
    expect(tree.children[3]).toEqual([4])
    expect(placed(tree)).toEqual([0, 1, 2, 3, 4])
  })

  it('keeps code reached only through a value or a file load out of the unreached bucket, in its own', () => {
    const tree = graph([
      ['main', [1], { entry: BIN }],
      ['reached', [], { untraced: 'value' }],
      ['handler', [3], { untraced: 'value' }],
      ['inner', []],
      ['dead', [5]],
      ['deadInner', []],
      ['loaded', [], { untraced: 'load' }],
    ])
    expect(tree.starts).toEqual([0])
    expect(tree.unknown).toEqual([2, 6])
    expect(tree.children[2]).toEqual([3])
    expect(tree.unreached).toEqual([4])
    expect(tree.children[4]).toEqual([5])
    expect(placed(tree)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('places an overload signature under its implementation, never on its own', () => {
    const tree = graph([
      ['main', [3], { entry: BIN }],
      ['parse', [], { overload: true, line: 2 }],
      ['parse', [], { overload: true, line: 3 }],
      ['parse', [], { line: 4 }],
      ['dead', [], { overload: true, line: 9 }],
      ['dead', [], { line: 10 }],
    ])
    expect(tree.children[3]).toEqual([1, 2])
    expect(tree.unreached).toEqual([5])
    expect(tree.children[5]).toEqual([4])
  })

  it('orders children by importance, then lines, then name, and keeps duplicate names apart', () => {
    const tree = graph([
      ['main', [1, 2, 3, 4], { entry: BIN }],
      ['run', [], { importance: 3, lines: 5 }],
      ['run', [], { importance: 3, lines: 5, file: 'b.ts' }],
      ['big', [], { importance: 3, lines: 50 }],
      ['top', [], { importance: 5 }],
    ])
    expect(tree.children[0]).toEqual([4, 3, 1, 2])
  })

  it('builds a 1,500 function tree quickly', () => {
    const specs: [string, number[], Partial<FunctionRow>?][] = Array.from({ length: 1500 }, (_, at) => [
      `f${at}`,
      [(at * 7 + 1) % 1500, (at + 1) % 1500],
      { entry: at % 100 === 0 ? BIN : null },
    ])
    const started = performance.now()
    const tree = graph(specs)
    expect(performance.now() - started).toBeLessThan(250)
    expect(placed(tree)).toEqual(specs.map((_, at) => at))
  })
})
