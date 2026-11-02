import { afterEach, describe, expect, it, vi } from 'vitest'
import { folderOf, pickable, storeScope, storedScope } from './pick'

const folders = [
  { path: 'reporter/frontend', functions: 1204 },
  { path: 'reporter/frontend/src', functions: 900 },
  { path: 'reporter/My Café', functions: 3 },
]

describe('pickable', () => {
  it('labels folders relative to the scope and keeps the count order', () => {
    expect(pickable(folders, 'reporter', '').map((folder) => folder.label)).toEqual([
      'frontend',
      'frontend/src',
      'My Café',
    ])
    expect(pickable(folders, '', '')[0]?.label).toBe('reporter/frontend')
  })

  it('filters by the relative label, ignoring case and blanks', () => {
    expect(pickable(folders, 'reporter', '  SRC ').map((folder) => folder.path)).toEqual(['reporter/frontend/src'])
    expect(pickable(folders, 'reporter', 'café')).toHaveLength(1)
    expect(pickable(folders, 'reporter', 'reporter')).toEqual([])
    expect(pickable([], '', 'x')).toEqual([])
  })
})

describe('folderOf', () => {
  it('gives the folder part of a file path', () => {
    expect(folderOf('reporter/frontend/a.ts')).toBe('reporter/frontend')
    expect(folderOf('main.ts')).toBe('')
  })
})

describe('stored scope', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('remembers a scope per project and forgets the whole project choice', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    })
    storeScope('/a', 'reporter')
    expect(storedScope('/a')).toBe('reporter')
    expect(storedScope('/b')).toBe('')
    storeScope('/a', '')
    expect(storedScope('/a')).toBe('')
    expect(storedScope(null)).toBe('')
  })

  it('falls back to the whole project when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => storeScope('/a', 'x')).not.toThrow()
    expect(storedScope('/a')).toBe('')
  })
})
