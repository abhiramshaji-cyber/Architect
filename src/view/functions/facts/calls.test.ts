import { describe, expect, it } from 'vitest'
import { callersOf } from './calls'

describe('callersOf', () => {
  it('turns each function list of callees into its list of callers', () => {
    expect(callersOf([[1, 2], [2], [], [0]])).toEqual([[3], [0], [0, 1], []])
  })

  it('handles no functions and ignores an index past the end', () => {
    expect(callersOf([])).toEqual([])
    expect(callersOf([[5]])).toEqual([[]])
  })
})
