import { describe, expect, it } from 'vitest'
import type { FunctionList, FunctionRow } from '../../../../shared/types'
import { callersOf, outsideOf, shownOf } from './calls'

const row = (name: string, over: Partial<FunctionRow> = {}): FunctionRow => ({
  file: 'a.ts',
  name,
  line: 1,
  lines: 1,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: null,
  importance: 1,
  ...over,
})

const list = (rows: FunctionRow[], calls: number[][]): FunctionList => ({
  rows,
  calls,
  tree: { starts: [], groups: [], unreached: [], children: [], also: [] },
  scope: '',
  folders: [],
})

describe('callersOf', () => {
  it('turns each function list of callees into its list of callers', () => {
    expect(callersOf([[1, 2], [2], [], [0]])).toEqual([[3], [0], [0, 1], []])
  })

  it('handles no functions and ignores an index past the end', () => {
    expect(callersOf([])).toEqual([])
    expect(callersOf([[5]])).toEqual([[]])
  })
})

describe('outsideOf', () => {
  it('reads the outside count for the asked direction, zero when absent', () => {
    const r = row('a', { outsideCallers: 2, outsideCallees: 3 })
    expect([outsideOf(r, 'callers'), outsideOf(r, 'callees'), outsideOf(row('b'), 'callers')]).toEqual([2, 3, 0])
  })
})

describe('shownOf', () => {
  const rows = [row('a'), row('b'), row('c', { outsideCallers: 4 })]
  const calls = [[1, 2], [2, 9], []]
  const shown = list(rows, calls)

  it('lists callees and callers by row', () => {
    expect(shownOf(shown, callersOf(calls), { at: 0, way: 'callees' })?.related.map((r) => r.row.name)).toEqual(['b', 'c'])
    expect(shownOf(shown, callersOf(calls), { at: 2, way: 'callers' })?.related.map((r) => r.row.name)).toEqual(['a', 'b'])
  })

  it('skips an index with no row and carries the outside count', () => {
    expect(shownOf(shown, callersOf(calls), { at: 1, way: 'callees' })?.related.map((r) => r.at)).toEqual([2])
    expect(shownOf(shown, callersOf(calls), { at: 2, way: 'callers' })?.outside).toBe(4)
  })

  it('shows nothing for a row that is gone and an empty list when only outside callers exist', () => {
    expect(shownOf(shown, callersOf(calls), { at: 7, way: 'callers' })).toBeNull()
    expect(shownOf(list([row('x', { outsideCallers: 1 })], [[]]), [[]], { at: 0, way: 'callers' })).toEqual({
      row: row('x', { outsideCallers: 1 }),
      related: [],
      outside: 1,
    })
  })
})
