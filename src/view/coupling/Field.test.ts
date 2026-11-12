import { describe, expect, it } from 'vitest'
import { wholeIn } from './Field'

describe('wholeIn', () => {
  it('takes a whole number inside the bounds, edges included', () => {
    expect([wholeIn('2', 2, 9), wholeIn(' 9 ', 2, 9), wholeIn('5', 2, 9)]).toEqual([2, 9, 5])
  })

  it('refuses empty, fractional, out of range and non numeric text', () => {
    for (const text of ['', ' ', '1', '10', '2.5', 'abc', '1e9', 'Infinity', 'NaN']) expect(wholeIn(text, 2, 9)).toBeNull()
  })
})
