import { describe, expect, it } from 'vitest'
import type { FunctionList, FunctionRow } from '../../../shared/types'
import { callersOf } from '../functions/facts/calls'
import { sidesOf } from './sides'

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

const listOf = (rows: FunctionRow[], calls: number[][]): FunctionList => ({
  rows,
  calls,
  tree: { starts: [], groups: [], unreached: [], children: [], also: [] },
  scope: '',
  folders: [],
})

const wide = { callers: 100, callees: 100 }

describe('sidesOf', () => {
  it('lists callers and callees from the call edges with the outside counts', () => {
    const list = listOf([row('hub', { outsideCallers: 2, outsideCallees: 1 }), row('a'), row('b')], [[2], [0], []])
    expect(sidesOf(list, callersOf(list.calls), 0, wide)).toEqual({
      callers: { shown: [1], more: 0, outside: 2 },
      callees: { shown: [2], more: 0, outside: 1 },
      mutual: new Set(),
    })
  })

  it('ranks by importance, then callers, then name, file and line', () => {
    const rows = [
      row('hub'),
      row('low', { importance: 1 }),
      row('top', { importance: 5 }),
      row('b', { importance: 3, fanIn: 2 }),
      row('a', { importance: 3, fanIn: 2 }),
      row('a', { importance: 3, fanIn: 2, file: 'z.ts' }),
      row('many', { importance: 3, fanIn: 9 }),
    ]
    const calls = [[], [0], [0], [0], [0], [0], [0]]
    const list = listOf(rows, calls)
    expect(sidesOf(list, callersOf(calls), 0, wide)?.callers.shown).toEqual([2, 6, 4, 5, 3, 1])
  })

  it('caps each side and counts the rest, the same way every time', () => {
    const rows = [row('hub'), ...Array.from({ length: 300 }, (_, i) => row(`f${String(i).padStart(3, '0')}`))]
    const calls = [[], ...rows.slice(1).map(() => [0])]
    const list = listOf(rows, calls)
    const first = sidesOf(list, callersOf(calls), 0, { callers: 12, callees: 12 })
    expect(first?.callers.shown).toHaveLength(12)
    expect(first?.callers.more).toBe(288)
    expect(first?.callers.shown[0]).toBe(1)
    expect(sidesOf(list, callersOf(calls), 0, { callers: 12, callees: 12 })).toEqual(first)
    expect(sidesOf(list, callersOf(calls), 0, { callers: 1000, callees: 0 })?.callers).toEqual({ shown: rows.slice(1).map((_, i) => i + 1), more: 0, outside: 0 })
  })

  it('treats a bad limit as nothing shown rather than throwing', () => {
    const list = listOf([row('hub'), row('a')], [[], [0]])
    expect(sidesOf(list, callersOf(list.calls), 0, { callers: -3, callees: NaN })?.callers).toEqual({ shown: [], more: 1, outside: 0 })
  })

  it('marks a function that both calls and is called by the focus as mutual', () => {
    const list = listOf([row('even'), row('odd'), row('other')], [[1, 2], [0], [0]])
    const sides = sidesOf(list, callersOf(list.calls), 0, wide)
    expect([...(sides?.mutual ?? [])].sort()).toEqual([1, 2])
  })

  it('returns nothing for a row that is gone and skips edges to missing rows', () => {
    const list = listOf([row('a')], [[5]])
    expect(sidesOf(list, callersOf(list.calls), 3, wide)).toBeNull()
    expect(sidesOf(list, callersOf(list.calls), 0, wide)?.callees.shown).toEqual([])
  })
})
