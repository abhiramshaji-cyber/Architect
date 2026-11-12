import { describe, expect, it } from 'vitest'
import type { Architecture, CodeMap, FileEntry } from '../../shared/types'
import { audit } from '../../cli/check'
import { crossings } from './crossings'
import { layersOf } from './index'
import { levelize } from './level'

function file(path: string, calls: [string, number][][] = []): FileEntry {
  return {
    path,
    functions: calls.map((refs, at) => ({
      name: `f${at}`,
      line: at * 10 + 1,
      endLine: at * 10 + 5,
      description: '',
      calls: refs.map(([target, fn]) => ({ file: target, fn })),
    })),
  }
}

function codeMap(...files: FileEntry[]): CodeMap {
  return { root: '/p', scannedAt: 0, folders: [{ path: '', folders: [], files }] }
}

function contract(edges: [string, string][], forbidden: [string, string][] = []): Architecture {
  return {
    title: 'T',
    summary: '',
    components: ['ui', 'core', 'db', 'log'].map((id) => ({ id, purpose: '', owns: [`${id}/**`] })),
    edges: edges.map(([from, to]) => ({ from, to })),
    forbidden: forbidden.map(([from, to]) => ({ from, to, reason: `${from} never calls ${to}` })),
    packages: [],
  }
}

const MAP = codeMap(
  file('ui/a.ts', [[['core/b.ts', 0], ['db/c.ts', 0]], [['core/b.ts', 1], ['ui/x.ts', 0]]]),
  file('ui/x.ts', [[]]),
  file('core/b.ts', [[['db/c.ts', 0]], [['db/c.ts', 9]]]),
  file('db/c.ts', [[['core/b.ts', 0]]]),
  file('readme.ts', [[['ui/a.ts', 0]]]),
)

describe('crossings', () => {
  it('pairs every call between files of different owners with its caller and callee lines', () => {
    const found = crossings(MAP, null)
    expect(found.map((c) => `${c.from}>${c.to}`)).toEqual(['ui>core', 'ui>db', 'ui>core', 'core>db', 'core>db', 'db>core', '.>ui'])
    expect(found[2]?.call).toEqual({ file: 'ui/a.ts', line: 11, fn: 'f1', target: 'core/b.ts', targetLine: 11, targetFn: 'f1' })
    expect(found[4]?.call).toMatchObject({ target: 'db/c.ts', targetLine: 1, targetFn: '' })
  })

  it('skips unowned files and counts a file with two owners for each', () => {
    const architecture = contract([])
    architecture.components.push({ id: 'shared', purpose: '', owns: ['db/c.ts'] })
    const found = crossings(MAP, architecture)
    expect(found.some((c) => c.call.file === 'readme.ts')).toBe(false)
    expect(found.filter((c) => c.call.file === 'db/c.ts').map((c) => c.from).sort()).toEqual(['db', 'shared'])
  })
})

describe('levelize', () => {
  it('puts leaves on level 1 and callers above the longest path below them', () => {
    const rows = levelize(['a', 'b', 'c', 'd'], [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'a', to: 'c' },
    ])
    expect(rows.map((r) => `${r.id}${r.level}`)).toEqual(['c1', 'd1', 'b2', 'a3'])
  })

  it('folds a cycle into one block on one level, contiguous and sorted', () => {
    const rows = levelize(['z', 'y', 'x', 'w'], [
      { from: 'z', to: 'x' },
      { from: 'x', to: 'z' },
      { from: 'y', to: 'z' },
      { from: 'x', to: 'w' },
    ])
    expect(rows).toEqual([
      { id: 'w', level: 1, block: 0 },
      { id: 'x', level: 2, block: 1 },
      { id: 'z', level: 2, block: 1 },
      { id: 'y', level: 3, block: 2 },
    ])
  })

  it('handles no components, duplicates and edges to unknown ids', () => {
    expect(levelize([], [{ from: 'a', to: 'b' }])).toEqual([])
    expect(levelize(['a', 'a'], [{ from: 'a', to: 'ghost' }])).toEqual([{ id: 'a', level: 1, block: 0 }])
  })
})

describe('layersOf', () => {
  it('colours each cell by the contract and keeps stale edges', () => {
    const layers = layersOf(contract([['ui', 'core'], ['core', 'db'], ['ui', 'log']], [['ui', 'db']]), MAP)
    const status = Object.fromEntries(layers.cells.map((c) => [`${c.from}>${c.to}`, `${c.status}:${c.calls.length}`]))
    expect(status).toEqual({ 'ui>core': 'allowed:2', 'ui>db': 'forbidden:1', 'core>db': 'allowed:2', 'db>core': 'undrawn:1', 'ui>log': 'stale:0' })
    expect(layers.cells.find((c) => c.from === 'db')?.verdict).toEqual({ status: 'cycle', path: ['db', 'core', 'db'] })
    expect(layers.contract).toBe(true)
  })

  it('keeps a drawn edge allowed when its files only import each other, and stale when they share nothing', () => {
    const map = codeMap(file('ui/a.ts'), { ...file('log/l.ts'), imports: ['core/b.ts'] }, file('core/b.ts'))
    const status = Object.fromEntries(
      layersOf(contract([['log', 'core'], ['ui', 'core']]), map).cells.map((c) => [`${c.from}>${c.to}`, `${c.status}:${c.calls.length}`]),
    )
    expect(status).toEqual({ 'log>core': 'allowed:0', 'ui>core': 'stale:0' })
  })

  it('shows no cell for an undrawn import with no calls, matching architect check', () => {
    const map = codeMap({ ...file('log/l.ts'), imports: ['core/b.ts', 'log/m.ts'] }, file('core/b.ts'))
    expect(layersOf(contract([]), map).cells).toEqual([])
  })

  it('orders rows by level with the cycle as one block above the diagonal', () => {
    const { rows } = layersOf(contract([['ui', 'core'], ['core', 'db']]), MAP)
    expect(rows).toEqual([
      { id: 'core', level: 1, block: 0 },
      { id: 'db', level: 1, block: 0 },
      { id: 'log', level: 1, block: 1 },
      { id: 'ui', level: 2, block: 2 },
    ])
  })

  it('flags exactly the pairs architect check reports', () => {
    const architecture = contract([['ui', 'core']], [['ui', 'db']])
    const flagged = layersOf(architecture, MAP).cells.filter((c) => c.status === 'forbidden' || c.status === 'undrawn')
    expect(flagged.map((c) => `${c.from} -> ${c.to}`).sort()).toEqual(audit(architecture, MAP).map((v) => `${v.from} -> ${v.to}`))
  })

  it('falls back to top level folders without a contract', () => {
    const layers = layersOf(null, MAP)
    expect(layers.contract).toBe(false)
    expect(layers.rows.map((r) => r.id)).toEqual(['core', 'db', 'ui', '.'])
    expect(layers.cells.every((c) => c.status === 'free' && c.verdict === undefined)).toBe(true)
  })

  it('returns an empty matrix for an empty project', () => {
    expect(layersOf(null, codeMap())).toEqual({ contract: false, rows: [], cells: [] })
  })
})
