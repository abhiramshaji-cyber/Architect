import { describe, expect, it } from 'vitest'
import type { CodeMap, EntryReason, FileEntry } from '../../shared/types'
import { edgesOf, factsOf } from './facts'

function mapOf(files: FileEntry[]): CodeMap {
  return {
    root: '/r',
    scannedAt: 0,
    folders: [{ path: '', folders: [], files }],
  }
}

const fn = (name: string, line: number, endLine: number, calls: { file: string; fn: number }[] = []) => ({
  name,
  line,
  endLine,
  description: '',
  calls,
})

describe('factsOf', () => {
  it('returns nothing for a project with no functions', () => {
    expect(factsOf(mapOf([]), new Map())).toEqual([])
    expect(factsOf(mapOf([{ path: 'a.ts', functions: [] }]), new Map())).toEqual([])
  })

  it('counts distinct callers across files and never counts a function calling itself', () => {
    const map = mapOf([
      {
        path: 'a.ts',
        imports: ['b.ts'],
        functions: [
          fn('a', 1, 3, [
            { file: 'b.ts', fn: 0 },
            { file: 'b.ts', fn: 0 },
          ]),
          fn('loop', 5, 9, [
            { file: 'a.ts', fn: 1 },
            { file: 'b.ts', fn: 0 },
          ]),
        ],
      },
      { path: 'b.ts', functions: [{ ...fn('b', 1, 1), exported: true }] },
    ])

    const facts = factsOf(map, new Map())
    const by = Object.fromEntries(facts.map((f) => [f.name, f]))

    expect(by.b).toMatchObject({
      fanIn: 2,
      fanOut: 0,
      lines: 1,
      exported: true,
      entry: null,
    })
    expect(by.loop).toMatchObject({
      fanIn: 0,
      fanOut: 1,
      lines: 5,
      exported: false,
    })
    expect(by.a).toMatchObject({ fanIn: 0, fanOut: 1, lines: 3, entry: null })
  })

  it('never makes a function a starting point only because nothing imports its file', () => {
    const map = mapOf([
      { path: 'orphan.ts', functions: [fn('lonely', 1, 1)] },
      { path: 'script.mjs', functions: [fn('run', 1, 1)], starts: [{ kind: 'load', calls: [{ file: 'script.mjs', fn: 0 }] }] },
    ])
    expect(factsOf(map, new Map()).map((f) => f.entry)).toEqual([null, null])
  })

  it('names every handler reason at the function the registration points to', () => {
    const kinds = ['mcpTool', 'ipcHandler', 'bridge', 'cliCommand'] as const
    const map = mapOf([
      { path: 'lib.ts', functions: kinds.map((kind, at) => fn(kind, at + 1, at + 1)) },
      { path: 'wire.ts', functions: [], starts: kinds.map((kind, at) => ({ kind, calls: [{ file: 'lib.ts', fn: at }] })) },
    ])
    expect(factsOf(map, new Map()).map((f) => f.entry)).toEqual(kinds.map((reason) => ({ reason, file: 'wire.ts' })))
  })

  it('names a file reason only for what its load time code runs, and the public api for main', () => {
    const reasons: EntryReason[] = ['electronMain', 'preload', 'renderer', 'page', 'bin', 'main']
    const files: FileEntry[] = reasons.map((reason) => ({
      path: `${reason}.ts`,
      functions: [fn('ran', 1, 1), fn('idle', 2, 2), { ...fn('api', 3, 3), exported: true }],
      starts: [{ kind: 'load', calls: [{ file: `${reason}.ts`, fn: 0 }] }],
    }))
    const facts = factsOf(mapOf(files), new Map(reasons.map((reason) => [`${reason}.ts`, [reason]])))
    reasons.forEach((reason, at) => {
      expect(facts[at * 3]?.entry).toEqual({ reason, file: `${reason}.ts` })
      expect(facts[at * 3 + 1]?.entry).toBeNull()
      expect(facts[at * 3 + 2]?.entry).toEqual(reason === 'main' ? { reason, file: 'main.ts' } : null)
    })
  })

  it('follows re-exports of a main file and ignores load code in files that are not entries', () => {
    const map = mapOf([
      { path: 'index.ts', functions: [], starts: [{ kind: 'exports', calls: [{ file: 'impl.ts', fn: 0 }] }] },
      { path: 'impl.ts', functions: [fn('feature', 1, 1)], starts: [{ kind: 'load', calls: [{ file: 'impl.ts', fn: 0 }] }] },
    ])
    expect(factsOf(map, new Map([['index.ts', ['main']]])).map((f) => f.entry)).toEqual([
      { reason: 'main', file: 'index.ts' },
    ])
    expect(factsOf(map, new Map()).map((f) => f.entry)).toEqual([null])
  })

  it('keeps the most specific reason when several apply, the first file breaking ties', () => {
    const map = mapOf([
      { path: 'b.ts', functions: [], starts: [{ kind: 'cliCommand', calls: [{ file: 'lib.ts', fn: 0 }] }] },
      {
        path: 'a.ts',
        functions: [],
        starts: [
          { kind: 'load', calls: [{ file: 'lib.ts', fn: 0 }] },
          { kind: 'cliCommand', calls: [{ file: 'lib.ts', fn: 0 }] },
        ],
      },
      { path: 'lib.ts', functions: [fn('run', 1, 1)] },
    ])
    expect(factsOf(map, new Map([['a.ts', ['bin']]]))[0]?.entry).toEqual({ reason: 'cliCommand', file: 'a.ts' })
  })

  it('never treats a test file as a starting point, nor anything a test file registers', () => {
    const map = mapOf([
      { path: 'a.test.ts', functions: [fn('t', 1, 1)], starts: [{ kind: 'load', calls: [{ file: 'lib.ts', fn: 0 }] }] },
      { path: '__tests__/b.ts', functions: [], starts: [{ kind: 'mcpTool', calls: [{ file: 'lib.ts', fn: 0 }] }] },
      { path: 'c.spec.tsx', functions: [fn('v', 1, 1)] },
      { path: 'lib.ts', functions: [fn('x', 1, 1)] },
      { path: 'wire.ts', functions: [], starts: [{ kind: 'ipcHandler', calls: [{ file: 'c.spec.tsx', fn: 0 }] }] },
    ])
    const entries = new Map<string, EntryReason[]>([['a.test.ts', ['bin']], ['c.spec.tsx', ['bin']]])
    expect(factsOf(map, entries).map((f) => f.entry)).toEqual([null, null, null])
  })

  it('never reports a line count below one for a malformed span', () => {
    expect(factsOf(mapOf([{ path: 'a.ts', functions: [fn('odd', 9, 3)] }]), new Map())[0]?.lines).toBe(1)
  })
})

describe('edgesOf', () => {
  it('links calls by position, dropping self calls, repeats and refs that point nowhere', () => {
    const map = mapOf([
      {
        path: 'a.ts',
        functions: [
          fn('a', 1, 1, [
            { file: 'a.ts', fn: 0 },
            { file: 'b.ts', fn: 1 },
            { file: 'b.ts', fn: 1 },
            { file: 'b.ts', fn: 9 },
            { file: 'gone.ts', fn: 0 },
          ]),
        ],
      },
      { path: 'b.ts', functions: [fn('b', 1, 1), fn('c', 2, 2, [{ file: 'a.ts', fn: 0 }])] },
    ])
    expect(edgesOf(map)).toEqual([[2], [], [0]])
  })
})
