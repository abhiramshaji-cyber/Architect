import { describe, expect, it } from 'vitest'
import type { FunctionRow } from '../../../shared/types'
import { back, forward, go, keyOf, resolve } from './history'

const row = (name: string, file = 'a.ts', line = 1): FunctionRow => ({
  file,
  name,
  line,
  lines: 1,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: false,
  importance: 1,
})

describe('trail', () => {
  it('starts, moves, goes back and forward, and drops forward on a new step', () => {
    const a = go(null, 'a')
    const c = go(go(a, 'b'), 'c')
    expect(c).toEqual({ back: ['a', 'b'], now: 'c', forward: [] })
    const twice = back(back(c))
    expect(twice).toEqual({ back: [], now: 'a', forward: ['b', 'c'] })
    expect(forward(twice)).toEqual({ back: ['a'], now: 'b', forward: ['c'] })
    expect(go(twice, 'd')).toEqual({ back: ['a'], now: 'd', forward: [] })
  })

  it('stays put at either end and on a step to the same place', () => {
    const a = go(null, 'a')
    expect(back(a)).toBe(a)
    expect(forward(a)).toBe(a)
    expect(go(a, 'a')).toBe(a)
  })
})

describe('resolve', () => {
  const rows = [row('run'), row('run', 'a.ts', 9), row('load', 'b.ts', 4)]

  it('finds the exact function, or the only one of that name in that file after lines move', () => {
    expect(resolve(rows, keyOf(rows[1] as FunctionRow))).toBe(1)
    expect(resolve(rows, keyOf(row('load', 'b.ts', 40)))).toBe(2)
  })

  it('gives up when the moved name is ambiguous or gone', () => {
    expect(resolve(rows, keyOf(row('run', 'a.ts', 5)))).toBe(-1)
    expect(resolve(rows, keyOf(row('gone')))).toBe(-1)
    expect(resolve([], 'junk')).toBe(-1)
  })
})
