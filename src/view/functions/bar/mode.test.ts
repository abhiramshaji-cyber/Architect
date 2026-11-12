import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { storeFocus, storeMode, storedFocus, storedMode } from './mode'

const memory = new Map<string, string>()

const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
}

beforeEach(() => vi.stubGlobal('localStorage', storage))

afterEach(() => memory.clear())

describe('stored mode', () => {
  it('remembers each mode per project root', () => {
    storeMode('/a', 'focus')
    storeMode('/b', 'tree')
    expect([storedMode('/a'), storedMode('/b')]).toEqual(['focus', 'tree'])
  })

  it('falls back to the list for no root, an unknown value or a storage that throws', () => {
    memory.set('architect.functions.mode:/a', 'graph')
    expect([storedMode(null), storedMode('/a'), storedMode('/never')]).toEqual(['list', 'list', 'list'])
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(storedMode('/a')).toBe('list')
    expect(() => storeMode('/a', 'tree')).not.toThrow()
  })
})

describe('stored focus', () => {
  it('remembers the focused function per project root, apart from the mode', () => {
    storeFocus('/a', 'a.ts\u00001\u0000run')
    storeMode('/a', 'focus')
    expect([storedFocus('/a'), storedFocus('/b'), storedFocus(null), storedMode('/a')]).toEqual(['a.ts\u00001\u0000run', null, null, 'focus'])
  })

  it('reads nothing from a storage that throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    storeFocus('/a', 'x')
    expect(storedFocus('/a')).toBeNull()
  })
})
