import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../../../shared/types'
import { ago, byMoment, collapse, merge, rowOf, targetOf } from './history'

function entry(over: Partial<HistoryEntry>): HistoryEntry {
  return { id: 'h', root: '/r', at: 0, source: 'contract', added: [], changed: [], removed: [], ...over }
}

describe('history', () => {
  it('names components and edges instead of showing raw ids', () => {
    expect(rowOf(entry({ added: ['db', 'db->api'] }))).toMatchObject({ change: 'added', name: 'db, db → api', parent: '' })
    expect(rowOf(entry({ added: ['db'], removed: ['old'] }))?.change).toBe('changed')
  })

  it('splits a code file into its name and parent folder', () => {
    const code = entry({ source: 'code', added: ['folder:src/new', 'codefile:src/view/a.ts'], changed: ['folder:src'] })
    expect(rowOf(code)).toMatchObject({ change: 'added', name: 'a.ts', parent: 'src/view' })
    expect(rowOf(entry({ source: 'code', file: 'a.ts' }))).toMatchObject({ change: 'changed', name: 'a.ts', parent: '' })
    expect(rowOf(entry({ source: 'code', changed: ['folder:src'] }))).toBeNull()
  })

  it('collapses consecutive entries for the same file into one counted row', () => {
    const edits = [
      entry({ id: 'c', source: 'code', file: 'src/a.ts' }),
      entry({ id: 'b', source: 'code', file: 'src/a.ts' }),
      entry({ id: 'x', source: 'code', file: 'src/b.ts' }),
      entry({ id: 'a', source: 'code', file: 'src/a.ts' }),
    ]
    expect(collapse(edits).map((r) => [r.entry.id, r.count])).toEqual([['c', 2], ['x', 1], ['a', 1]])
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
