import { describe, expect, it } from 'vitest'
import type { CodeMap, FileEntry } from '../../shared/types'
import { functionsOf } from './index'

function mapOf(files: FileEntry[]): CodeMap {
  return { root: '/r', scannedAt: 0, folders: [{ path: '', folders: [], files }] }
}

const fn = (name: string, calls: { file: string; fn: number }[] = []) => ({
  name,
  line: 1,
  endLine: 3,
  description: '',
  calls,
})

describe('functionsOf', () => {
  it('returns nothing for an empty project and a full row for a single function', () => {
    expect(functionsOf(mapOf([]), new Set())).toEqual({
      rows: [],
      calls: [],
      tree: { starts: [], unreached: [], children: [], also: [] },
      scope: '',
      folders: [],
    })
    expect(functionsOf(mapOf([{ path: 'a.ts', functions: [fn('loadConfig')] }]), new Set()).rows).toEqual([
      {
        file: 'a.ts',
        name: 'loadConfig',
        line: 1,
        lines: 3,
        fanIn: 0,
        fanOut: 0,
        exported: false,
        entry: true,
        importance: 3,
      },
    ])
  })

  it('carries the scanned signature and doc verbatim and leaves them out when the scan has none', () => {
    const signature = { params: [{ name: 'root', type: 'string' }], returns: 'Config' }
    const doc = 'Loads it.\n@param root where'
    const { rows } = functionsOf(mapOf([{ path: 'a.ts', functions: [{ ...fn('load'), signature, doc }, fn('bare')] }]), new Set())
    expect(rows[0]).toMatchObject({ signature, doc })
    expect(rows[1]).not.toHaveProperty('signature')
    expect(rows[1]).not.toHaveProperty('doc')
  })

  it('lists the calls between rows by row index', () => {
    const map = mapOf([
      { path: 'a.ts', functions: [fn('a', [{ file: 'b.ts', fn: 0 }, { file: 'b.ts', fn: 1 }]), fn('c')] },
      { path: 'b.ts', functions: [fn('b', [{ file: 'a.ts', fn: 1 }]), fn('d')] },
    ])
    expect(functionsOf(map, new Set()).calls).toEqual([[2, 3], [], [1], []])
  })

  it('fills every row, keeps duplicate names apart and survives a cycle', () => {
    const map = mapOf([
      { path: 'a.ts', imports: ['b.ts'], functions: [fn('run', [{ file: 'b.ts', fn: 0 }]), fn('run')] },
      {
        path: 'b.ts',
        imports: ['a.ts'],
        functions: [fn('ping', [{ file: 'b.ts', fn: 1 }]), fn('pong', [{ file: 'b.ts', fn: 0 }])],
      },
    ])
    const { rows } = functionsOf(map, new Set())
    expect(rows).toHaveLength(4)
    expect(rows.every((row) => row.importance >= 1 && row.importance <= 5)).toBe(true)
    expect(rows.map((row) => row.fanIn)).toEqual([0, 0, 2, 1])
    expect(rows[2]?.importance).toBeGreaterThan(rows[1]?.importance ?? 0)
  })

  it('handles a large project well inside the time budget', () => {
    const files: FileEntry[] = Array.from({ length: 500 }, (_, f) => ({
      path: `src/f${f}.ts`,
      imports: [`src/f${(f + 1) % 500}.ts`],
      functions: Array.from({ length: 3 }, (_, i) =>
        fn(`loadThing${f}x${i}`, [
          { file: `src/f${(f * 7 + i) % 500}.ts`, fn: i },
          { file: `src/f${(f + 1) % 500}.ts`, fn: (i + 1) % 3 },
        ]),
      ),
    }))
    const started = performance.now()
    const { rows, tree } = functionsOf(mapOf(files), new Set())
    const spent = performance.now() - started
    expect(rows).toHaveLength(1500)
    expect(tree.children.flat().length + tree.starts.length + tree.unreached.length).toBe(1500)
    expect(new Set(rows.map((row) => row.importance)).size).toBeGreaterThan(1)
    expect(spent).toBeLessThan(250)
  })
})

function foldered(files: FileEntry[]): CodeMap {
  const folders = new Map<string, FileEntry[]>([['', []]])
  for (const file of files) {
    const parts = file.path.split('/').slice(0, -1)
    parts.forEach((_, at) => {
      const folder = parts.slice(0, at + 1).join('/')
      if (!folders.has(folder)) folders.set(folder, [])
    })
    folders.get(parts.join('/'))?.push(file)
  }
  return {
    root: '/r',
    scannedAt: 0,
    folders: [...folders].map(([path, own]) => ({
      path,
      files: own,
      folders: [...folders.keys()].filter(
        (sub) => sub !== '' && sub.slice(0, Math.max(0, sub.lastIndexOf('/'))) === path,
      ),
    })),
  }
}

const call = (file: string, at = 0) => ({ file, fn: at })

describe('functionsOf in a folder', () => {
  const map = foldered([
    {
      path: 'app/main.ts',
      imports: ['app/core/a.ts', 'lib/x.ts'],
      functions: [fn('main', [call('app/core/a.ts'), call('lib/x.ts')])],
    },
    { path: 'app/core/a.ts', functions: [fn('run', [call('app/core/a.ts', 1)]), fn('load')] },
    { path: 'lib/x.ts', imports: ['app/core/a.ts'], functions: [fn('helper', [call('app/core/a.ts', 1)])] },
    { path: 'empty/types.ts', functions: [] },
  ])

  it('counts only callers inside the folder and flags outside callers', () => {
    const { rows, scope } = functionsOf(map, new Set(), 'app/core/')
    expect(scope).toBe('app/core')
    expect(rows.map((row) => [row.name, row.fanIn, row.outsideCallers])).toEqual([
      ['run', 0, 1],
      ['load', 1, 1],
    ])
    expect(functionsOf(map, new Set(), 'app/core').calls).toEqual([[1], []])
    expect(functionsOf(map, new Set()).rows.every((row) => row.outsideCallers === undefined && row.outsideCallees === undefined)).toBe(true)
  })

  it('counts only callees inside the folder and flags outside callees', () => {
    const { rows } = functionsOf(map, new Set(), 'app')
    expect(rows.map((row) => [row.name, row.fanOut, row.outsideCallees])).toEqual([
      ['main', 1, 1],
      ['run', 1, undefined],
      ['load', 0, undefined],
    ])
  })

  it('roots the tree at uncalled functions in the folder with no unreached bucket for them', () => {
    const { tree } = functionsOf(map, new Set(), 'app/core')
    expect(tree).toEqual({ starts: [0], unreached: [], children: [[1], []], also: [0, 0] })
  })

  it('puts real starting points first, then the other uncalled functions', () => {
    const { rows, tree } = functionsOf(map, new Set(), 'app')
    expect(tree.starts.map((at) => rows[at]?.name)).toEqual(['main'])
    const lib = functionsOf(
      foldered([
        { path: 'pkg/start.ts', functions: [fn('boot', [call('pkg/deep/b.ts')])] },
        { path: 'pkg/deep/b.ts', functions: [fn('loose', [call('pkg/deep/b.ts', 1)]), fn('called')] },
        { path: 'pkg/user.ts', imports: ['pkg/deep/b.ts'], functions: [fn('ping', [call('pkg/deep/b.ts', 1)])] },
      ]),
      new Set(),
      'pkg',
    )
    expect(lib.tree.starts.map((at) => lib.rows[at]?.name)).toEqual(['boot', 'ping'])
    expect(lib.tree.unreached).toEqual([])
  })

  it('keeps only a cycle that nothing in the folder reaches in the unreached bucket', () => {
    const cyc = functionsOf(
      foldered([
        { path: 'pkg/a.ts', imports: ['pkg/b.ts'], functions: [fn('ping', [call('pkg/b.ts')])] },
        { path: 'pkg/b.ts', imports: ['pkg/a.ts'], functions: [fn('pong', [call('pkg/a.ts')])] },
        { path: 'pkg/c.ts', imports: ['pkg/a.ts'], functions: [fn('solo')] },
      ]),
      new Set(),
      'pkg',
    )
    expect(cyc.tree.starts.map((at) => cyc.rows[at]?.name)).toEqual(['solo'])
    expect(cyc.tree.unreached).toHaveLength(1)
    expect(['ping', 'pong']).toContain(cyc.rows[cyc.tree.unreached[0] ?? -1]?.name)
  })

  it('spreads importance within the folder instead of the whole project', () => {
    const files: FileEntry[] = [
      { path: 'pkg/hub.ts', imports: [], functions: [fn('hub')] },
      ...Array.from({ length: 19 }, (_, i) => ({
        path: `pkg/u${i}.ts`,
        imports: ['pkg/hub.ts'],
        functions: [fn(`use${i}`, [call('pkg/hub.ts')])],
      })),
      { path: 'pkg/leaf.ts', imports: [], functions: [fn('leaf')] },
      ...Array.from({ length: 60 }, (_, i) => ({
        path: `other/o${i}.ts`,
        imports: ['pkg/leaf.ts'],
        functions: [fn(`out${i}`, [call('pkg/leaf.ts')])],
      })),
    ]
    const whole = functionsOf(foldered(files), new Set())
    const byName = (rows: typeof whole.rows, name: string) => rows.find((row) => row.name === name)
    expect(byName(whole.rows, 'leaf')?.importance).toBe(5)

    const pkg = functionsOf(foldered(files), new Set(), 'pkg')
    expect(pkg.rows).toHaveLength(21)
    expect(byName(pkg.rows, 'hub')?.importance).toBe(5)
    expect(byName(pkg.rows, 'leaf')?.importance).toBeLessThan(5)
    expect(byName(pkg.rows, 'leaf')?.outsideCallers).toBe(60)
    expect(Math.min(...pkg.rows.map((row) => row.importance))).toBe(1)
  })

  it('handles an empty folder, a missing folder and a path outside the project', () => {
    expect(functionsOf(map, new Set(), 'empty')).toEqual({
      rows: [],
      calls: [],
      tree: { starts: [], unreached: [], children: [], also: [] },
      scope: 'empty',
      folders: [],
    })
    for (const gone of ['deleted', '../r', '/elsewhere', 'app/main.ts']) {
      const list = functionsOf(map, new Set(), gone)
      expect(list.scope).toBe('')
      expect(list.rows).toHaveLength(4)
    }
    expect(functionsOf(map, new Set(), 'app').folders).toEqual([{ path: 'app/core', functions: 2 }])
  })

  it('narrows a large project to one folder well inside the time budget', () => {
    const files: FileEntry[] = Array.from({ length: 2000 }, (_, f) => ({
      path: `pkg${f % 20}/sub${f % 3}/f${f}.ts`,
      functions: Array.from({ length: 5 }, (_, i) =>
        fn(`loadThing${f}x${i}`, [call(`pkg${(f * 7) % 20}/sub${(f * 7) % 3}/f${(f * 7) % 2000}.ts`, i)]),
      ),
    }))
    const big = foldered(files)
    const started = performance.now()
    const { rows, tree, scope } = functionsOf(big, new Set(), 'pkg3')
    const spent = performance.now() - started
    expect(scope).toBe('pkg3')
    expect(rows).toHaveLength(500)
    expect(rows.every((row) => row.file.startsWith('pkg3/'))).toBe(true)
    expect(tree.children.flat().length + tree.starts.length + tree.unreached.length).toBe(500)
    expect(spent).toBeLessThan(250)
  })
})
