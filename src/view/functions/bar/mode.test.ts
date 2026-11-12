import { afterEach, describe, expect, it, vi } from 'vitest'
import { storeMode, storedMode } from './mode'

const memory = new Map<string, string>()

vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
})

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
