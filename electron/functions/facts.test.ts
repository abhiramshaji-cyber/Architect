import { describe, expect, it } from 'vitest'
import type { CodeMap, FileEntry } from '../../shared/types'
import { declaredEntries, factsOf } from './facts'

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
    expect(factsOf(mapOf([]), new Set())).toEqual([])
    expect(factsOf(mapOf([{ path: 'a.ts', functions: [] }]), new Set())).toEqual([])
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

    const facts = factsOf(map, new Set())
    const by = Object.fromEntries(facts.map((f) => [f.name, f]))

    expect(by.b).toMatchObject({
      fanIn: 2,
      fanOut: 0,
      lines: 1,
      exported: true,
      entry: false,
    })
    expect(by.loop).toMatchObject({
      fanIn: 0,
      fanOut: 1,
      lines: 5,
      exported: false,
    })
    expect(by.a).toMatchObject({ fanIn: 0, fanOut: 1, lines: 3, entry: true })
  })

  it('treats a file as a starting point when nothing loads it or the manifest names it', () => {
    const map = mapOf([
      { path: 'main.ts', imports: ['lib.ts'], functions: [fn('start', 1, 1)] },
      { path: 'lib.ts', functions: [fn('help', 1, 1)] },
      { path: 'cli.ts', imports: ['lib.ts'], functions: [fn('run', 1, 1)] },
      { path: 'loaded.ts', functions: [fn('x', 1, 1)] },
      { path: 'other.ts', imports: ['loaded.ts'], functions: [] },
    ])

    const entries = factsOf(map, new Set(['lib.ts'])).map((f) => [f.file, f.entry])
    expect(entries).toEqual([
      ['main.ts', true],
      ['lib.ts', true],
      ['cli.ts', true],
      ['loaded.ts', false],
    ])
  })

  it('never reports a line count below one for a malformed span', () => {
    expect(factsOf(mapOf([{ path: 'a.ts', functions: [fn('odd', 9, 3)] }]), new Set())[0]?.lines).toBe(1)
  })
})

describe('declaredEntries', () => {
  it('reads main and every bin, dropping a leading ./', () => {
    expect(
      declaredEntries({
        main: './src/index.ts',
        bin: { a: 'cli/a.js', b: './cli/b.js' },
      }),
    ).toEqual(new Set(['src/index.ts', 'cli/a.js', 'cli/b.js']))
    expect(declaredEntries({ bin: 'run.js' })).toEqual(new Set(['run.js']))
  })

  it('ignores a missing or malformed manifest', () => {
    expect(declaredEntries(null)).toEqual(new Set())
    expect(declaredEntries('nope')).toEqual(new Set())
    expect(declaredEntries({ main: 3, bin: [null, ''] })).toEqual(new Set())
  })
})
