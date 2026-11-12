import { describe, expect, it } from 'vitest'
import type { FunctionRow } from '../../../shared/types'
import { keyOf, placeOf, resolve, walk } from './history'

const row = (name: string, file = 'a.ts', line = 1): FunctionRow => ({
  file,
  name,
  line,
  lines: 1,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: null,
  importance: 1,
})

describe('walk', () => {
  const to = (key: string) => ({ to: key })

  it('starts, moves, goes back and forward, and drops forward on a new step', () => {
    const a = walk(null, to('a'))
    const c = walk(walk(a, to('b')), to('c'))
    expect(c).toEqual({ back: ['a', 'b'], now: 'c', forward: [] })
    const twice = walk(walk(c, 'back'), 'back')
    expect(twice).toEqual({ back: [], now: 'a', forward: ['b', 'c'] })
    expect(walk(twice, 'forward')).toEqual({ back: ['a'], now: 'b', forward: ['c'] })
    expect(walk(twice, to('d'))).toEqual({ back: ['a'], now: 'd', forward: [] })
  })

  it('stays put at either end, with no trail, and on a step to the same place', () => {
    const a = walk(null, to('a'))
    expect(walk(a, 'back')).toBe(a)
    expect(walk(a, 'forward')).toBe(a)
    expect(walk(a, to('a'))).toBe(a)
    expect(walk(null, 'back')).toBeNull()
    expect(walk(null, 'forward')).toBeNull()
  })

  it('records a step between two functions that share a name in one file', () => {
    const first = walk(null, to(keyOf(row('run', 'a.ts', 3))))
    expect(walk(first, to(keyOf(row('run', 'a.ts', 9))))?.back).toEqual([keyOf(row('run', 'a.ts', 3))])
  })
})

describe('placeOf', () => {
  it('keeps the file and name and drops the line, so a moved function is the same place', () => {
    expect(placeOf(keyOf(row('run', 'a.ts', 3)))).toBe(placeOf(keyOf(row('run', 'a.ts', 40))))
    expect(placeOf(keyOf(row('run', 'a.ts')))).not.toBe(placeOf(keyOf(row('run', 'b.ts'))))
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
