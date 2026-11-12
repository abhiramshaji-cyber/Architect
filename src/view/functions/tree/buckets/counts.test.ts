import { describe, expect, it } from 'vitest'
import { preorderOf, sizesOf, talliesOf } from './counts'

const kids = new Map([
  ['root', ['b1', 'b2']],
  ['b1', ['f0', 'f1']],
  ['f1', ['f2']],
  ['b2', ['f3']],
])

const calls = new Map([
  ['f0', ['f1', 'f3']],
  ['f1', ['f2']],
  ['f2', []],
  ['f3', ['f0', 'f2']],
])

describe('counts', () => {
  it('walks the outline depth first and sums weights up every branch', () => {
    expect(preorderOf(kids, 'root')).toEqual(['root', 'b1', 'f0', 'f1', 'f2', 'b2', 'f3'])
    const sizes = sizesOf(kids, 'root', (id) => (calls.has(id) ? 1 : 0))
    expect(sizes.get('root')).toBe(4)
    expect(sizes.get('b1')).toBe(3)
    expect(sizes.get('f1')).toBe(2)
  })

  it('counts functions, starting points and the calls that cross each bucket edge', () => {
    const tallies = talliesOf(kids, 'root', ['b1', 'b2', 'missing'], calls, new Set(['f0', 'f3']))
    expect(tallies.get('b1')).toEqual({ functions: 3, starts: 1, callsIn: 2, callsOut: 1 })
    expect(tallies.get('b2')).toEqual({ functions: 1, starts: 1, callsIn: 1, callsOut: 2 })
    expect(tallies.has('missing')).toBe(false)
  })

  it('survives a cycle in the kids map without looping', () => {
    const looped = new Map([['a', ['b']], ['b', ['a']]])
    expect(preorderOf(looped, 'a')).toEqual(['a', 'b'])
  })
})
