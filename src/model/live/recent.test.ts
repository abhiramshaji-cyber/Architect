import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../../../shared/types'
import { absorb, addedIds, liveClass, prune, LIVE_MS } from './recent'

function entry(over: Partial<HistoryEntry>): HistoryEntry {
  return { id: 'h', root: '/r', at: 0, source: 'contract', added: [], changed: [], removed: [], ...over }
}

describe('recent', () => {
  it('marks every id in an entry with its kind', () => {
    const recent = absorb({}, entry({ added: ['cache', 'api->cache'], changed: ['api'], removed: ['old'] }), 10)

    expect(liveClass(recent, 'cache')).toBe('live-added')
    expect(liveClass(recent, 'api->cache')).toBe('live-added')
    expect(liveClass(recent, 'api')).toBe('live-changed')
    expect(liveClass(recent, 'old')).toBe('live-removed')
    expect(liveClass(recent, 'db')).toBeUndefined()
    expect(addedIds(recent)).toEqual(['cache', 'api->cache'])
  })

  it('keeps a node that is still arriving as added when it changes again', () => {
    const first = absorb({}, entry({ added: ['cache'] }), 0)
    expect(absorb(first, entry({ changed: ['cache'] }), 100).cache).toEqual({ kind: 'added', at: 100 })
  })

  it('lets a removal override an earlier mark', () => {
    const first = absorb({}, entry({ added: ['cache'] }), 0)
    expect(liveClass(absorb(first, entry({ removed: ['cache'] }), 5), 'cache')).toBe('live-removed')
  })

  it('drops marks once they have settled and keeps the rest', () => {
    const recent = absorb(absorb({}, entry({ added: ['a'] }), 0), entry({ changed: ['b'] }), 1000)

    expect(Object.keys(prune(recent, LIVE_MS - 1))).toEqual(['a', 'b'])
    expect(Object.keys(prune(recent, LIVE_MS))).toEqual(['b'])
    expect(prune(recent, LIVE_MS + 1000)).toEqual({})
  })
})
