import { describe, expect, it } from 'vitest'
import { unquote, unquotePath } from '.'

describe('unquote', () => {
  it('decodes named escapes, an escaped quote and octal bytes as utf8', () => {
    expect(unquote('"a\\tb\\n\\"q\\" \\\\ caf\\303\\251"')).toEqual({ value: 'a\tb\n"q" \\ café', end: 28 })
  })

  it('keeps a character outside the basic plane intact', () => {
    expect(unquote('"wt\\t\\"q\\" 😀"')?.value).toBe('wt\t"q" 😀')
    expect(unquote('"\\360\\237\\230\\200"')?.value).toBe('😀')
  })

  it('stops at the closing quote and reports where it ended', () => {
    expect(unquote('"a b" "c"')).toEqual({ value: 'a b', end: 5 })
  })

  it('refuses text that is not quoted, never closes, or carries an unknown escape', () => {
    expect(unquote('plain')).toBeNull()
    expect(unquote('"open')).toBeNull()
    expect(unquote('"a\\qb"')).toBeNull()
    expect(unquote('"\\400"')).toBeNull()
  })
})

describe('unquotePath', () => {
  it('decodes a fully quoted path and keeps anything else as given', () => {
    expect(unquotePath('"/home/u/a\\nb"')).toBe('/home/u/a\nb')
    expect(unquotePath('"/home/u/caf\\303\\251"')).toBe('/home/u/café')
    expect(unquotePath('"wt\\t\\"q\\" 😀"')).toBe('wt\t"q" 😀')
    expect(unquotePath('/home/u/plain')).toBe('/home/u/plain')
    expect(unquotePath('"a" b')).toBe('"a" b')
    expect(unquotePath('"')).toBe('"')
  })
})
