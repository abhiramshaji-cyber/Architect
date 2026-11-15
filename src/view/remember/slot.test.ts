import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keep, recall } from './slot'

const memory = new Map<string, string>()

const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
}

beforeEach(() => vi.stubGlobal('localStorage', storage))

afterEach(() => memory.clear())

describe('remembered view state', () => {
  it('keeps each view part per project root', () => {
    keep('flow', 'depth', '/a', '5')
    keep('flow', 'depth', '/b', '2')
    keep('map', 'depth', '/a', 'x')
    expect([recall('flow', 'depth', '/a'), recall('flow', 'depth', '/b'), recall('map', 'depth', '/a')]).toEqual(['5', '2', 'x'])
    expect(memory.get('architect.flow.depth:/a')).toBe('5')
  })

  it('forgets a part kept as null and ignores a missing root', () => {
    keep('code', 'selected', '/a', 'codefile:a.ts')
    keep('code', 'selected', '/a', null)
    keep('code', 'selected', null, 'codefile:b.ts')
    expect([recall('code', 'selected', '/a'), recall('code', 'selected', null), memory.size]).toEqual([null, null, 0])
  })

  it('reads nothing and throws nothing from a storage that throws', () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(() => keep('map', 'lens', '/a', 'churn')).not.toThrow()
    expect(() => keep('map', 'lens', '/a', null)).not.toThrow()
    expect(recall('map', 'lens', '/a')).toBeNull()
  })
})
