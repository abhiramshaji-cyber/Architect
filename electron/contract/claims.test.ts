import { describe, expect, it } from 'vitest'
import type { CodeMap, FunctionEntry, HistoryEntry } from '../../shared/types'
import { createClaims } from './claims'

const fn = (name: string): FunctionEntry => ({ name, line: 1, endLine: 2, description: '', calls: [] })

const map = (files: Record<string, string[]>): CodeMap => ({
  root: '/r',
  scannedAt: 1,
  folders: [{ path: '', folders: [], files: Object.entries(files).map(([path, names]) => ({ path, functions: names.map(fn) })) }],
})

function setup(limit = 10) {
  let rows: HistoryEntry[] = []
  const emitted: HistoryEntry[] = []
  const journal = {
    list: () => rows,
    append: (_root: string, entry: HistoryEntry) => (rows = [entry, ...rows]),
    replace: (_root: string, old: HistoryEntry, next: HistoryEntry[]) => (rows = rows.flatMap((row) => (row === old ? next : [row]))),
  }
  const claims = createClaims(journal, limit, (entry) => emitted.push(entry))
  return { claims, emitted, rows: () => rows }
}

const before = map({ 'a.ts': ['a'], 'b.ts': ['b'] })
const after = map({ 'a.ts': ['a', 'a2'], 'b.ts': ['b'] })
const digests = new Map([['a.ts', 'h-a'], ['b.ts', 'h-b']])

function watcherSaved(claims: ReturnType<typeof setup>['claims']) {
  for (const change of claims.changes('/r', before, after, [])) claims.record('/r', 'code', change, 1, digests)
}

describe('createClaims', () => {
  it('records and emits an entry, and skips an empty change', () => {
    const { claims, emitted, rows } = setup()
    claims.record('/r', 'contract', { added: ['x'], changed: [], removed: [] })
    claims.record('/r', 'code', { added: [], changed: [], removed: [] })

    expect(rows()).toHaveLength(1)
    expect(emitted).toEqual(rows())
  })

  it('takes over the watcher entry when the hook saw the same content', () => {
    const { claims, emitted, rows } = setup()
    watcherSaved(claims)
    const touch = { file: 'a.ts', session: 's1', at: Date.now(), digest: 'h-a' }

    expect(claims.changes('/r', after, after, [touch])).toEqual([])
    expect(rows()).toEqual([expect.objectContaining({ changed: ['codefile:a.ts'], session: 's1', file: 'a.ts' })])
    expect(emitted.at(-1)).toMatchObject({ session: 's1' })
  })

  it.each([
    ['the content differs', { digest: 'other' }],
    ['the hook sent no digest', { digest: undefined }],
    ['the hook has no session', { session: undefined }],
    ['the record is older than the hook deadline', { at: Date.now() + 60_000 }],
  ])('saves the touch fresh when %s', (_name, fields) => {
    const { claims, rows } = setup()
    watcherSaved(claims)
    const touch = { file: 'a.ts', session: 's1', at: Date.now(), digest: 'h-a', ...fields }

    expect(claims.changes('/r', after, after, [touch])).toEqual([
      expect.objectContaining({ changed: ['codefile:a.ts'], ...(touch.session ? { session: 's1' } : {}) }),
    ])
    expect(rows()[0]?.session).toBeUndefined()
  })

  it('takes nothing over when another session touched the file in the same rescan', () => {
    const { claims, rows } = setup()
    watcherSaved(claims)
    const at = Date.now()
    const touched = [
      { file: 'a.ts', session: 's1', at, digest: 'h-a' },
      { file: 'a.ts', session: 's2', at, digest: 'h-a' },
    ]

    expect(claims.changes('/r', after, after, touched)).toEqual([expect.not.objectContaining({ session: expect.anything() })])
    expect(rows().at(-1)?.session).toBeUndefined()
  })

  it('records a file that changed again now instead of taking an entry over', () => {
    const { claims } = setup()
    watcherSaved(claims)
    const later = map({ 'a.ts': ['a', 'a2', 'a3'], 'b.ts': ['b'] })

    expect(claims.changes('/r', after, later, [{ file: 'a.ts', session: 's1', at: Date.now(), digest: 'h-a' }])).toEqual([
      expect.objectContaining({ changed: ['codefile:a.ts'], session: 's1' }),
    ])
  })

  it('forgets the hashes of the oldest entries past the limit', () => {
    const { claims, rows } = setup(1)
    watcherSaved(claims)
    claims.record('/r', 'code', { added: [], changed: ['codefile:b.ts'], removed: [] }, 2, digests)

    expect(claims.changes('/r', after, after, [{ file: 'a.ts', session: 's1', at: Date.now(), digest: 'h-a' }])).toHaveLength(1)
    expect(rows().every((row) => row.session === undefined)).toBe(true)
  })
})
