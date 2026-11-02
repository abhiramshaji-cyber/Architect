import { describe, expect, it } from 'vitest'
import type { FunctionRow } from '../../shared/types'
import { treeOf } from './tree'

const row = (name: string, over: Partial<FunctionRow> = {}): FunctionRow => ({
  file: 'a.ts',
  name,
  line: 1,
  lines: 1,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: false,
  importance: 1,
  summary: '',
  ...over,
})

function graph(specs: [string, number[], Partial<FunctionRow>?][]) {
  const edges = specs.map(([, out]) => out)
  const fanIn = specs.map((_, at) => edges.filter((out) => out.includes(at)).length)
  const rows = specs.map(([name, out, over], at) => row(name, { fanIn: fanIn[at], fanOut: out.length, ...over }))
  return treeOf(rows, edges)
}

const placed = (tree: ReturnType<typeof treeOf>) =>
  [...tree.starts, ...tree.unreached, ...tree.children.flat()].sort((a, b) => a - b)

describe('treeOf', () => {
  it('handles an empty project and a single function', () => {
    expect(treeOf([], [])).toEqual({
      starts: [],
      unreached: [],
      children: [],
      also: [],
    })
    expect(graph([['main', [], { entry: true }]])).toEqual({
      starts: [0],
      unreached: [],
      children: [[]],
      also: [0],
    })
    expect(graph([['lonely', []]])).toEqual({
      starts: [],
      unreached: [0],
      children: [[]],
      also: [0],
    })
  })

  it('roots at uncalled functions in starting point files, most important first', () => {
    const tree = graph([
      ['page', [2], { entry: true, importance: 2 }],
      ['layout', [2], { entry: true, importance: 4 }],
      ['shared', []],
      ['called', [], { entry: true }],
      ['caller', [3]],
    ])
    expect(tree.starts).toEqual([1, 0])
    expect(tree.children[1]).toEqual([2])
    expect(tree.children[0]).toEqual([])
    expect(tree.also[2]).toBe(1)
    expect(tree.unreached).toEqual([4])
    expect(tree.children[4]).toEqual([3])
  })

  it('places every function exactly once, under its shallowest and most important caller', () => {
    const tree = graph([
      ['main', [1, 2], { entry: true }],
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
      ['main', [], { entry: true }],
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

  it('orders children by importance, then lines, then name, and keeps duplicate names apart', () => {
    const tree = graph([
      ['main', [1, 2, 3, 4], { entry: true }],
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
      { entry: at % 100 === 0 },
    ])
    const started = performance.now()
    const tree = graph(specs)
    expect(performance.now() - started).toBeLessThan(250)
    expect(placed(tree)).toEqual(specs.map((_, at) => at))
  })
})
