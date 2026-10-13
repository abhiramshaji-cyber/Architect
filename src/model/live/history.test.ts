import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../../../shared/types'
import { ago, byMoment, lineOf, merge, targetOf } from './history'

function entry(over: Partial<HistoryEntry>): HistoryEntry {
  return { id: 'h', root: '/r', at: 0, source: 'contract', added: [], changed: [], removed: [], ...over }
}

describe('history', () => {
  it('names components and edges instead of showing raw ids', () => {
    expect(lineOf(entry({ added: ['db', 'db->api'], removed: ['old'] }))).toBe('+ db, + db → api, − old')
  })

  it('shows code paths and leaves out folders that only changed because a file inside did', () => {
    const code = entry({ source: 'code', added: ['folder:src/new'], changed: ['codefile:src/a.ts', 'folder:src'] })
    expect(lineOf(code)).toBe('+ src/new/, ~ src/a.ts')
  })

  it('falls back to the touched file when no node moved', () => {
    expect(lineOf(entry({ source: 'code', file: 'src/a.ts' }))).toBe('~ src/a.ts')
  })

  it('points a contract entry at a component, or the source of an edge', () => {
    expect(targetOf(entry({ added: ['api->cache', 'cache'] }))).toEqual({ kind: 'node', id: 'cache' })
    expect(targetOf(entry({ added: ['api->cache'] }))).toEqual({ kind: 'node', id: 'api' })
    expect(targetOf(entry({ removed: ['old'] }))).toBeNull()
  })

  it('points a code entry at its file', () => {
    expect(targetOf(entry({ source: 'code', changed: ['folder:src', 'codefile:src/a.ts'] }))).toEqual({ kind: 'file', path: 'src/a.ts' })
    expect(targetOf(entry({ source: 'code', changed: ['folder:src'] }))).toBeNull()
  })

  it('merges by id newest first so a late load never duplicates a live entry', () => {
    const live = entry({ id: 'b', at: 200 })
    expect(merge([live], [entry({ id: 'a', at: 100 }), live]).map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('groups consecutive entries that read the same time', () => {
    const now = 10 * 60_000
    const groups = byMoment([entry({ id: 'c', at: now - 5_000 }), entry({ id: 'b', at: now - 50_000 }), entry({ id: 'a', at: now - 125_000 })], now)
    expect(groups.map((g) => [g.label, g.entries.map((e) => e.id)])).toEqual([['now', ['c', 'b']], ['2m', ['a']]])
  })

  it('says how long ago in the shortest calm form', () => {
    expect(ago(1000, 30_000)).toBe('now')
    expect(ago(0, 2 * 60_000)).toBe('2m')
    expect(ago(0, 3 * 3_600_000)).toBe('3h')
    expect(ago(0, 2 * 86_400_000)).toBe('2d')
    expect(ago(5000, 0)).toBe('now')
  })
})
