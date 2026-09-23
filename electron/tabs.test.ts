import { describe, expect, it } from 'vitest'
import { LAST_TAB, TAB_DIGITS, claim, owner, tabIndex } from './tabs'

describe('tabIndex', () => {
  it('maps the first eight digits to their own tab', () => {
    for (let digit = 1; digit <= 8; digit++) expect(tabIndex(digit, 8)).toBe(digit - 1)
  })

  it('sends the ninth digit to the last tab, not the ninth', () => {
    expect(tabIndex(LAST_TAB, 3)).toBe(2)
    expect(tabIndex(LAST_TAB, 1)).toBe(0)
    expect(tabIndex(LAST_TAB, 12)).toBe(11)
  })

  it('lands on the ninth tab when there are exactly nine', () => {
    expect(tabIndex(LAST_TAB, 9)).toBe(8)
  })

  it('does nothing past the end of the tab list', () => {
    expect(tabIndex(4, 3)).toBeNull()
    expect(tabIndex(2, 1)).toBeNull()
  })

  it('does nothing with no tabs at all', () => {
    expect(tabIndex(1, 0)).toBeNull()
    expect(tabIndex(LAST_TAB, 0)).toBeNull()
  })

  it('rejects a digit outside one to nine', () => {
    expect(tabIndex(0, 5)).toBeNull()
    expect(tabIndex(10, 20)).toBeNull()
    expect(tabIndex(-1, 5)).toBeNull()
    expect(tabIndex(1.5, 5)).toBeNull()
    expect(tabIndex(Number.NaN, 5)).toBeNull()
  })

  it('covers every digit key the chord listens for', () => {
    expect(TAB_DIGITS).toHaveLength(LAST_TAB)
    expect(TAB_DIGITS.indexOf('Digit9') + 1).toBe(LAST_TAB)
    expect(TAB_DIGITS.indexOf('KeyT')).toBe(-1)
  })
})

describe('owner', () => {
  it('finds the window holding a root', () => {
    const claims = new Map([
      [1, '/a'],
      [2, '/b'],
    ])
    expect(owner(claims, '/b')).toBe(2)
  })

  it('returns null when no window holds it', () => {
    expect(owner(new Map([[1, '/a']]), '/b')).toBeNull()
    expect(owner(new Map(), '/a')).toBeNull()
  })

  it('releases the root when its window is forgotten', () => {
    const claims = new Map([[1, '/a']])
    claims.delete(1)
    expect(owner(claims, '/a')).toBeNull()
  })

  it('moves the claim when a window switches root', () => {
    const claims = new Map([[1, '/a']])
    claims.set(1, '/b')
    expect(owner(claims, '/a')).toBeNull()
    expect(owner(claims, '/b')).toBe(1)
  })
})

describe('claim', () => {
  const live = (ids: number[]) => (id: number) => ids.includes(id)

  it('grants a free root', () => {
    const claims = new Map<number, string>()
    expect(claim(claims, live([1]), 1, '/a')).toBe(true)
    expect(owner(claims, '/a')).toBe(1)
  })

  it('refuses a root a live tab already holds', () => {
    const claims = new Map([[1, '/a']])
    expect(claim(claims, live([1, 2]), 2, '/a')).toBe(false)
    expect(owner(claims, '/a')).toBe(1)
  })

  it('regrants to the tab that already holds it', () => {
    const claims = new Map([[1, '/a']])
    expect(claim(claims, live([1]), 1, '/a')).toBe(true)
    expect([...claims]).toEqual([[1, '/a']])
  })

  it('takes over a root whose tab is gone, leaving one holder', () => {
    const claims = new Map([[1, '/a']])
    expect(claim(claims, live([2]), 2, '/a')).toBe(true)
    expect([...claims]).toEqual([[2, '/a']])
    expect(owner(claims, '/a')).toBe(2)
  })

  it('moves a tab off its previous root when it claims another', () => {
    const claims = new Map<number, string>()
    claim(claims, live([1]), 1, '/a')
    claim(claims, live([1]), 1, '/b')
    expect(owner(claims, '/a')).toBeNull()
    expect(owner(claims, '/b')).toBe(1)
  })
})
