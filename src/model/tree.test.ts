import { describe, expect, it } from 'vitest'
import type { TreeEntry } from '../../shared/types'
import { childPath, hue, parentPath, rows, slice, step, type Listings } from './tree'

const dir = (name: string): TreeEntry => ({ name, dir: true, owners: [] })
const file = (name: string, owners: string[] = []): TreeEntry => ({ name, dir: false, owners })

const listings: Listings = {
  '': [dir('src'), file('README.md')],
  src: [dir('view'), file('index.ts', ['canvas'])],
  'src/view': [file('App.tsx', ['canvas', 'ui'])],
}

describe('childPath', () => {
  it('joins a name onto a folder and treats the root as empty', () => {
    expect(childPath('', 'src')).toBe('src')
    expect(childPath('src', 'view')).toBe('src/view')
  })
})

describe('parentPath', () => {
  it('drops the last segment and bottoms out at the root', () => {
    expect(parentPath('src/view/App.tsx')).toBe('src/view')
    expect(parentPath('src')).toBe('')
    expect(parentPath('')).toBe('')
  })
})

describe('rows', () => {
  it('returns nothing until the root listing has arrived', () => {
    expect(rows({}, new Set())).toEqual([])
  })

  it('only walks into folders that are open', () => {
    expect(rows(listings, new Set()).map((row) => row.path)).toEqual(['src', 'README.md'])
    expect(rows(listings, new Set(['src'])).map((row) => row.path)).toEqual([
      'src',
      'src/view',
      'src/index.ts',
      'README.md',
    ])
  })

  it('nests depth and carries owners through', () => {
    const all = rows(listings, new Set(['src', 'src/view']))

    expect(all.map((row) => [row.path, row.depth])).toEqual([
      ['src', 0],
      ['src/view', 1],
      ['src/view/App.tsx', 2],
      ['src/index.ts', 1],
      ['README.md', 0],
    ])
    expect(all.find((row) => row.path === 'src/view/App.tsx')?.owners).toEqual(['canvas', 'ui'])
  })

  it('marks an open folder whose children have not arrived as pending', () => {
    const all = rows({ '': [dir('src')] }, new Set(['src']))

    expect(all).toEqual([{ path: 'src', name: 'src', dir: true, owners: [], depth: 0, open: true, pending: true }])
  })
})

describe('slice', () => {
  const all = rows({ '': Array.from({ length: 5000 }, (_, i) => file(`f${i}.ts`)) }, new Set())

  it('renders a bounded window of a huge folder', () => {
    const shown = slice(all, 0, 400, 20)

    expect(all).toHaveLength(5000)
    expect(shown.rows.length).toBeLessThan(80)
    expect(shown.rows[0]?.path).toBe('f0.ts')
  })

  it('keeps the total scroll height across the spacers', () => {
    const shown = slice(all, 20000, 400, 20)

    expect(shown.before + shown.rows.length * 20 + shown.after).toBe(5000 * 20)
    expect(shown.rows.map((row) => row.path)).toContain('f1000.ts')
  })

  it('clamps at both ends', () => {
    expect(slice(all, -500, 400, 20).before).toBe(0)
    expect(slice(all, 5000 * 20, 400, 20).after).toBe(0)
    expect(slice([], 0, 400, 20)).toEqual({ rows: [], before: 0, after: 0 })
  })
})

describe('step', () => {
  const all = rows(listings, new Set(['src']))

  it('moves by one and stops at the ends', () => {
    expect(step(all, 'src', 1)).toBe('src/view')
    expect(step(all, 'src', -1)).toBe('src')
    expect(step(all, 'README.md', 1)).toBe('README.md')
  })

  it('enters from the matching end when nothing is focused', () => {
    expect(step(all, null, 1)).toBe('src')
    expect(step(all, null, -1)).toBe('README.md')
    expect(step([], null, 1)).toBeNull()
  })
})

describe('hue', () => {
  it('is deterministic, in range, and differs between component ids', () => {
    expect(hue('canvas')).toBe(hue('canvas'))
    expect(hue('canvas')).not.toBe(hue('daemon'))
    for (const id of ['', 'a', 'canvas', 'daemon', 'types', 'lsp']) {
      expect(hue(id)).toBeGreaterThanOrEqual(0)
      expect(hue(id)).toBeLessThan(360)
    }
  })
})
