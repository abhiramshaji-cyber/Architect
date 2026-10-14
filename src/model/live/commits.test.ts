import { describe, expect, it } from 'vitest'
import type { Commit, HistoryEntry } from '../../../shared/types'
import { byCommit, commitOf, pathsOf } from './commits'

function entry(over: Partial<HistoryEntry>): HistoryEntry {
  return { id: 'h', root: '/r', at: 0, source: 'code', added: [], changed: [], removed: [], ...over }
}

function commit(sha: string, at: number, files: string[]): Commit {
  return { sha, short: sha.slice(0, 7), at, subject: sha, files }
}

describe('commits', () => {
  it('maps entries to the files git reports', () => {
    expect(pathsOf(entry({ source: 'contract', added: ['db'] }))).toEqual(['architect.md'])
    expect(pathsOf(entry({ file: 'a.ts', added: ['codefile:b.ts', 'folder:src'] }))).toEqual(['a.ts', 'b.ts', 'src/'])
  })

  it('puts an edit in the first later commit that touched its file', () => {
    const commits = [commit('c3', 30_000, ['a.ts']), commit('c2', 20_000, ['b.ts']), commit('c1', 10_000, ['a.ts'])]
    expect(commitOf(entry({ file: 'a.ts', at: 5_000 }), commits)?.sha).toBe('c1')
    expect(commitOf(entry({ file: 'a.ts', at: 15_000 }), commits)?.sha).toBe('c3')
    expect(commitOf(entry({ file: 'a.ts', at: 31_000 }), commits)).toBeNull()
    expect(commitOf(entry({ added: ['folder:src'], at: 0 }), [commit('f', 1_000, ['src/x.ts'])])?.sha).toBe('f')
  })

  it('treats a commit time as the whole second git rounded it down from', () => {
    expect(commitOf(entry({ file: 'a.ts', at: 10_700 }), [commit('c', 10_000, ['a.ts'])])?.sha).toBe('c')
  })

  it('lists uncommitted work first, then commits newest first', () => {
    const commits = [commit('new', 20_000, ['b.ts']), commit('old', 10_000, ['a.ts'])]
    const entries = [entry({ id: '3', file: 'c.ts', at: 25_000 }), entry({ id: '2', file: 'b.ts', at: 15_000 }), entry({ id: '1', file: 'a.ts', at: 5_000 })]
    const groups = byCommit(entries, commits)
    expect(groups.map((g) => [g.commit?.sha ?? null, g.entries.map((e) => e.id)])).toEqual([[null, ['3']], ['new', ['2']], ['old', ['1']]])
    expect(byCommit(entries, []).map((g) => g.entries.length)).toEqual([3])
  })
})
