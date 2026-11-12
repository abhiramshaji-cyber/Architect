import { describe, expect, it } from 'vitest'
import type { CodeMap, Commit, FileEntry, HistoryEntry } from '../../shared/types'
import { askOf, DEFAULT_ASK } from './ask'
import { coupled } from '.'
import { linker } from './linked'
import { pairKey, tally } from './pairs'

const DAY = 86_400_000
const NOW = 400 * DAY + 5

const file = (path: string, more: Partial<FileEntry> = {}): FileEntry => ({ path, functions: [], ...more })
const mapOf = (...files: FileEntry[]): CodeMap => ({ root: '/r', scannedAt: 0, folders: [{ path: '', folders: [], files }] })
const commit = (sha: string, files: string[], daysAgo = 1): Commit => ({ sha, short: sha.slice(0, 3), at: NOW - daysAgo * DAY, subject: `s ${sha}`, files })
const entry = (session: string | undefined, files: string[], daysAgo = 1, source: 'code' | 'contract' = 'code'): HistoryEntry => ({
  id: `${session}-${files.join()}`,
  root: '/r',
  at: NOW - daysAgo * DAY,
  source,
  added: [],
  changed: files.map((f) => `codefile:${f}`),
  removed: [],
  ...(session === undefined ? {} : { session }),
})

const loose = { minShared: 1, minConfidence: 0 }

describe('askOf', () => {
  it('fills defaults for anything missing, out of range, fractional where whole, or not a number', () => {
    expect(askOf(undefined)).toEqual(DEFAULT_ASK)
    expect(askOf({ days: 0, minShared: 2.5, minConfidence: 1.5, maxFiles: 1 })).toEqual(DEFAULT_ASK)
    expect(askOf({ days: Number.NaN, minShared: '4', minConfidence: Number.POSITIVE_INFINITY, maxFiles: null })).toEqual(DEFAULT_ASK)
    expect(askOf({ days: 365, minShared: 1, minConfidence: 0, maxFiles: 1000 })).toEqual({ days: 365, minShared: 1, minConfidence: 0, maxFiles: 1000 })
  })
})

describe('tally', () => {
  it('counts each change once per file, pairs each two known files once, and ignores unknown files', () => {
    const { counts, shared } = tally([{ id: 'x', files: ['b', 'a', 'a', 'gone'] }, { id: 'y', files: ['a', 'c'] }], new Set(['a', 'b', 'c']))
    expect(Object.fromEntries(counts)).toEqual({ a: 2, b: 1, c: 1 })
    expect(Object.fromEntries(shared)).toEqual({ [pairKey('a', 'b')]: ['x'], [pairKey('a', 'c')]: ['y'] })
    expect(pairKey('b', 'a')).toBe(pairKey('a', 'b'))
  })
})

describe('linker', () => {
  it('links a direct import either way, and an import of a file that re-exports the other, through chains and cycles', () => {
    const linked = linker(
      mapOf(
        file('a', { imports: ['index'] }),
        file('index', { imports: ['mid'], reexports: ['mid'] }),
        file('mid', { imports: ['b', 'index'], reexports: ['b', 'index'] }),
        file('b'),
        file('c', { imports: ['b'] }),
        file('d', { imports: ['plain'] }),
        file('plain', { imports: ['e'] }),
        file('e'),
      ),
    )
    expect([linked('a', 'b'), linked('b', 'a'), linked('c', 'b'), linked('b', 'c')]).toEqual([true, true, true, true])
    expect([linked('d', 'e'), linked('a', 'c'), linked('x', 'y')]).toEqual([false, false, false])
  })
})

describe('coupled', () => {
  const map = mapOf(file('a'), file('b'), file('c', { imports: ['a'] }), file('d'))

  it('scores commit co-change by shared commits over the fewer changes, and lists the commits as evidence', () => {
    const result = coupled(map, [commit('111', ['a', 'b']), commit('222', ['a', 'b', 'd']), commit('333', ['a'])], [], loose, NOW)
    const ab = result.pairs.find((pair) => pair.files.join() === 'a,b')
    expect(ab?.commits).toEqual({ shared: ['111', '222'], changes: [3, 2], confidence: 1 })
    expect(Object.keys(result.commits).sort()).toEqual(['111', '222'])
    expect(result.commits['111']).toEqual({ short: '111', at: NOW - DAY, subject: 's 111' })
  })

  it('leaves out pairs with an import either way', () => {
    const result = coupled(map, [commit('111', ['a', 'c'])], [], loose, NOW)
    expect(result.pairs).toEqual([])
  })

  it('skips commits over the file limit and counts them, and drops commits outside the window', () => {
    const result = coupled(map, [commit('big', ['a', 'b', 'd']), commit('old', ['a', 'b'], 30), commit('ok', ['a', 'b'])], [], { ...loose, maxFiles: 2, days: 7 }, NOW)
    expect(result.skipped).toBe(1)
    expect(result.pairs.map((pair) => pair.commits.shared)).toEqual([['ok']])
  })

  it('groups history by session, ignoring contract entries, unattributed entries and those outside the window', () => {
    const history = [entry('s1', ['a']), entry('s1', ['b']), entry('s2', ['a', 'b']), entry(undefined, ['a', 'b']), entry('s3', ['a', 'b'], 1, 'contract'), entry('s4', ['a', 'b'], 300)]
    const result = coupled(map, [], history, loose, NOW)
    expect(result.pairs).toEqual([{ files: ['a', 'b'], commits: { shared: [], changes: [0, 0], confidence: 0 }, sessions: { shared: ['s1', 's2'], changes: [2, 2], confidence: 1 } }])
    expect(result.sessions).toEqual({ s1: NOW - DAY, s2: NOW - DAY })
    expect(result.historyFrom).toBe(NOW - 300 * DAY)
  })

  it('keeps a pair when either source clears both thresholds, and ranks by total shared, then confidence, then name', () => {
    const commits = [commit('1', ['a', 'b']), commit('2', ['a', 'b']), commit('3', ['b', 'd']), commit('4', ['b', 'd']), commit('5', ['b', 'd']), commit('6', ['d'])]
    const history = [entry('s', ['b', 'd'])]
    const files = (ask: object) => coupled(map, commits, history, ask, NOW).pairs.map((pair) => pair.files.join())
    expect(files({ minShared: 2, minConfidence: 0.6 })).toEqual(['b,d', 'a,b'])
    expect(files({ minShared: 4, minConfidence: 0 })).toEqual([])
    expect(files({ minShared: 1, minConfidence: 0.8 })).toEqual(['b,d', 'a,b'])
    expect(files({ minShared: 2, minConfidence: 0.8 })).toEqual(['a,b'])
    const tied = coupled(map, [commit('1', ['a', 'd']), commit('2', ['a', 'b'])], [], loose, NOW).pairs.map((pair) => pair.files.join())
    expect(tied).toEqual(['a,b', 'a,d'])
  })

  it('returns nothing for an empty project or no history at all', () => {
    expect(coupled(mapOf(), [commit('1', ['a', 'b'])], [], loose, NOW)).toMatchObject({ pairs: [], commits: {}, sessions: {}, historyFrom: null, skipped: 0 })
  })
})
