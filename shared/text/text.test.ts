import { describe, expect, it } from 'vitest'
import { errorText } from './error'
import { percent } from './percent'
import { plural } from './plural'

describe('plural', () => {
  it('adds an s to every count but one', () => {
    expect(plural(0, 'file')).toBe('0 files')
    expect(plural(1, 'file')).toBe('1 file')
    expect(plural(2, 'shared commit')).toBe('2 shared commits')
    expect(plural(-1, 'file')).toBe('-1 files')
    expect(plural(1.5, 'line')).toBe('1.5 lines')
  })

  it('shows the count as given when told how', () => {
    expect(plural(1234, 'call', '1,234')).toBe('1,234 calls')
    expect(plural(1, 'call', 'one')).toBe('one call')
  })
})

describe('percent', () => {
  it('rounds a fraction to a whole percent', () => {
    expect(percent(0)).toBe('0%')
    expect(percent(0.125)).toBe('13%')
    expect(percent(0.994)).toBe('99%')
    expect(percent(1)).toBe('100%')
    expect(percent(1.5)).toBe('150%')
  })
})

describe('errorText', () => {
  it('reads the message of an Error and stringifies anything else', () => {
    expect(errorText(new TypeError('bad'))).toBe('bad')
    expect(errorText('plain')).toBe('plain')
    expect(errorText(42)).toBe('42')
    expect(errorText(undefined)).toBe('undefined')
    expect(errorText(null)).toBe('null')
  })
})
