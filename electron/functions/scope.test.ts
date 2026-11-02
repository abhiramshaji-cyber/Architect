import { describe, expect, it } from 'vitest'
import type { CodeMap } from '../../shared/types'
import { foldersOf, normalScope, scopeOf, subgraphOf, within } from './scope'

const fn = (name: string) => ({
  name,
  line: 1,
  endLine: 2,
  description: '',
  calls: [],
})

const map: CodeMap = {
  root: '/work/repo',
  scannedAt: 0,
  folders: [
    {
      path: '',
      folders: ['reporter', 'my docs', 'empty'],
      files: [{ path: 'main.ts', functions: [fn('main')] }],
    },
    {
      path: 'reporter',
      folders: ['reporter/frontend'],
      files: [{ path: 'reporter/a.ts', functions: [fn('a')] }],
    },
    {
      path: 'reporter/frontend',
      folders: ['reporter/frontend/src'],
      files: [{ path: 'reporter/frontend/b.ts', functions: [fn('b1'), fn('b2')] }],
    },
    {
      path: 'reporter/frontend/src',
      folders: [],
      files: [
        {
          path: 'reporter/frontend/src/c.ts',
          functions: [fn('c1'), fn('c2'), fn('c3')],
        },
        { path: 'reporter/frontend/src/types.ts', functions: [] },
      ],
    },
    { path: 'my docs', folders: ['my docs/café'], files: [] },
    {
      path: 'my docs/café',
      folders: [],
      files: [{ path: 'my docs/café/x.ts', functions: [fn('x')] }],
    },
    {
      path: 'empty',
      folders: [],
      files: [{ path: 'empty/types.ts', functions: [] }],
    },
    {
      path: 'reporter2',
      folders: [],
      files: [{ path: 'reporter2/z.ts', functions: [fn('z')] }],
    },
  ],
}

describe('normalScope', () => {
  it('normalizes slashes, dots and blanks', () => {
    expect(normalScope('/r', undefined)).toBe('')
    expect(normalScope('/r', 42)).toBe('')
    expect(normalScope('/r', '')).toBe('')
    expect(normalScope('/r', '  ')).toBe('')
    expect(normalScope('/r', '.')).toBe('')
    expect(normalScope('/r', './')).toBe('')
    expect(normalScope('/r', './reporter/')).toBe('reporter')
    expect(normalScope('/r', 'reporter//frontend/./')).toBe('reporter/frontend')
    expect(normalScope('/r', 'reporter/x/../frontend')).toBe('reporter/frontend')
  })

  it('rejects anything outside the project and accepts an absolute path inside it', () => {
    expect(normalScope('/r', '..')).toBeNull()
    expect(normalScope('/r', '../other')).toBeNull()
    expect(normalScope('/r', 'a/../../b')).toBeNull()
    expect(normalScope('/r', '/elsewhere/a')).toBeNull()
    expect(normalScope('/r', '/r')).toBe('')
    expect(normalScope('/r', '/r/a/b/')).toBe('a/b')
  })
})

describe('scopeOf', () => {
  it('keeps a real folder, including spaces and unicode', () => {
    expect(scopeOf(map, 'reporter/frontend/')).toBe('reporter/frontend')
    expect(scopeOf(map, './my docs/café')).toBe('my docs/café')
    expect(scopeOf(map, 'my docs/café')).toBe('my docs/café')
    expect(scopeOf(map, '/work/repo/reporter')).toBe('reporter')
    expect(scopeOf(map, 'empty')).toBe('empty')
  })

  it('falls back to the whole project for a missing folder, a file or a path outside', () => {
    expect(scopeOf(map, 'deleted')).toBe('')
    expect(scopeOf(map, 'reporter/a.ts')).toBe('')
    expect(scopeOf(map, '../repo/reporter')).toBe('')
    expect(scopeOf(map, '/work/other')).toBe('')
  })
})

describe('within', () => {
  it('matches files at any depth and never a sibling with the same prefix', () => {
    expect(within('reporter/a.ts', '')).toBe(true)
    expect(within('reporter/a.ts', 'reporter')).toBe(true)
    expect(within('reporter/frontend/src/c.ts', 'reporter')).toBe(true)
    expect(within('reporter2/z.ts', 'reporter')).toBe(false)
    expect(within('main.ts', 'reporter')).toBe(false)
  })
})

describe('foldersOf', () => {
  it('lists every folder holding functions with subtree counts, biggest first', () => {
    expect(foldersOf(map, '')).toEqual([
      { path: 'reporter', functions: 6 },
      { path: 'reporter/frontend', functions: 5 },
      { path: 'reporter/frontend/src', functions: 3 },
      { path: 'my docs', functions: 1 },
      { path: 'my docs/café', functions: 1 },
      { path: 'reporter2', functions: 1 },
    ])
  })

  it('lists only folders inside the scope and nothing for a leaf or empty folder', () => {
    expect(foldersOf(map, 'reporter')).toEqual([
      { path: 'reporter/frontend', functions: 5 },
      { path: 'reporter/frontend/src', functions: 3 },
    ])
    expect(foldersOf(map, 'reporter/frontend/src')).toEqual([])
    expect(foldersOf(map, 'empty')).toEqual([])
  })
})

describe('subgraphOf', () => {
  it('keeps only calls between kept functions, renumbered', () => {
    expect(subgraphOf([[1, 2], [2, 3], [0], []], [1, 2, 3])).toEqual([[1, 2], [], []])
    expect(subgraphOf([[1]], [])).toEqual([])
  })
})
