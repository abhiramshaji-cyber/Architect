import { describe, expect, it } from 'vitest'
import type { CodeMap, FileEntry, FolderEntry, FunctionEntry } from '../../shared/types'
import {
  baseName,
  callPositions,
  codePositions,
  columnsFor,
  crumbs,
  fileIndex,
  fnNodeId,
  folderIndex,
  functionEdges,
  functionNodes,
  hangingIndent,
  heightOf,
  parentOf,
  subtreeCounts,
  widthOf,
  worldNodes,
  worldPath,
  FN_BASE_H,
  FN_DESC_H,
  FN_NODE_W,
  FILE_BASE_H,
  FILE_NOTE_H,
  FN_ROW_H,
  FOLDER_H,
  FUNCTIONS_SHOWN,
  type CodeNode
} from './codemap'
import { NODE_W } from './layout'

function fns(count: number): FunctionEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `fn${i}`,
    line: i + 1,
    endLine: i + 1,
    description: '',
    calls: []
  }))
}

function map(folders: FolderEntry[]): CodeMap {
  return { root: '/repo', scannedAt: 0, folders }
}

const tree = map([
  { path: '', folders: ['src', 'mcp'], files: [{ path: 'index.ts', functions: fns(1) }] },
  { path: 'src', folders: ['src/ui'], files: [{ path: 'src/app.ts', functions: fns(3) }] },
  { path: 'src/ui', folders: [], files: [{ path: 'src/ui/Button.tsx', functions: fns(2) }] },
  { path: 'mcp', folders: [], files: [] }
])

describe('paths', () => {
  it('takes the last segment as a name', () => {
    expect(baseName('src/ui/Button.tsx')).toBe('Button.tsx')
    expect(baseName('src')).toBe('src')
    expect(baseName('')).toBe('')
  })

  it('walks one level up, stopping at the root', () => {
    expect(parentOf('src/ui/panels')).toBe('src/ui')
    expect(parentOf('src')).toBe('')
    expect(parentOf('')).toBe('')
  })
})

describe('folderIndex', () => {
  it('looks a folder up by path without walking', () => {
    const index = folderIndex(tree)
    expect(index.get('src/ui')?.files).toHaveLength(1)
    expect(index.get('')?.folders).toEqual(['src', 'mcp'])
    expect(index.get('nope')).toBeUndefined()
  })
})

describe('subtreeCounts', () => {
  const index = folderIndex(tree)

  it('counts the whole subtree, not the immediate children', () => {
    expect(subtreeCounts(index, '')).toEqual({ files: 3, functions: 6 })
    expect(subtreeCounts(index, 'src')).toEqual({ files: 2, functions: 5 })
    expect(subtreeCounts(index, 'src/ui')).toEqual({ files: 1, functions: 2 })
  })

  it('is zero for an empty folder and for an unknown path', () => {
    expect(subtreeCounts(index, 'mcp')).toEqual({ files: 0, functions: 0 })
    expect(subtreeCounts(index, 'ghost')).toEqual({ files: 0, functions: 0 })
  })

  it('terminates on a folder graph that points back at itself', () => {
    const cyclic = folderIndex(
      map([
        { path: 'a', folders: ['b'], files: [{ path: 'a/one.ts', functions: fns(1) }] },
        { path: 'b', folders: ['a'], files: [{ path: 'b/two.ts', functions: fns(2) }] }
      ])
    )
    expect(subtreeCounts(cyclic, 'a')).toEqual({ files: 2, functions: 3 })
  })
})

describe('heightOf', () => {
  it('is fixed for a folder', () => {
    expect(heightOf({ kind: 'folder', name: 'src', path: 'src', counts: { files: 1, functions: 1 } })).toBe(FOLDER_H)
  })

  it('grows one row per function', () => {
    const at = (count: number) => heightOf({ kind: 'codefile', name: 'a.ts', path: 'a.ts', functions: fns(count) })
    expect(at(1)).toBe(FILE_BASE_H + FN_ROW_H)
    expect(at(4)).toBe(FILE_BASE_H + 4 * FN_ROW_H)
    expect(at(FUNCTIONS_SHOWN)).toBe(FILE_BASE_H + FUNCTIONS_SHOWN * FN_ROW_H)
  })

  it('caps the rows and adds one note line past the cap', () => {
    const at = (count: number) => heightOf({ kind: 'codefile', name: 'a.ts', path: 'a.ts', functions: fns(count) })
    expect(at(FUNCTIONS_SHOWN + 1)).toBe(FILE_BASE_H + FUNCTIONS_SHOWN * FN_ROW_H + FILE_NOTE_H)
    expect(at(40)).toBe(at(FUNCTIONS_SHOWN + 1))
  })

  it('leaves room for the empty note when there are no functions', () => {
    expect(heightOf({ kind: 'codefile', name: 'a.ts', path: 'a.ts', functions: [] })).toBe(FILE_BASE_H + FILE_NOTE_H)
  })

  it('does not change when a description is empty', () => {
    const described = heightOf({
      kind: 'codefile',
      name: 'a.ts',
      path: 'a.ts',
      functions: [{ name: 'run', line: 1, endLine: 4, description: 'Does the thing.', calls: [] }]
    })
    const bare = heightOf({
      kind: 'codefile',
      name: 'a.ts',
      path: 'a.ts',
      functions: [{ name: 'run', line: 1, endLine: 4, description: '', calls: [] }]
    })
    expect(bare).toBe(described)
  })
})

describe('worldNodes', () => {
  const index = folderIndex(tree)

  it('lists immediate folders before immediate files', () => {
    const nodes = worldNodes(index, '')
    expect(nodes.map((n) => n.data.kind)).toEqual(['folder', 'codefile'])
    expect(nodes.map((n) => n.data.name)).toEqual(['src', 'index.ts'])
  })

  it('carries subtree counts on folder nodes', () => {
    const src = worldNodes(index, '')[0]
    expect(src?.data.kind === 'folder' && src.data.counts).toEqual({ files: 2, functions: 5 })
  })

  it('gives every node a unique id and its own height', () => {
    const nodes = worldNodes(index, 'src')
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length)
    expect(nodes.every((n) => n.height === heightOf(n.data))).toBe(true)
  })

  it('is empty for a folder that is not in the map', () => {
    expect(worldNodes(index, 'ghost')).toEqual([])
  })

  it('leaves out a file with no functions', () => {
    const withReadme = folderIndex(
      map([{ path: '', folders: [], files: [{ path: 'README.md', functions: [] }, { path: 'a.ts', functions: fns(1) }] }])
    )
    expect(worldNodes(withReadme, '').map((n) => n.data.name)).toEqual(['a.ts'])
  })

  it('leaves out a folder whose whole subtree has no functions', () => {
    expect(worldNodes(index, '').some((n) => n.data.path === 'mcp')).toBe(false)
  })

  it('keeps a folder whose only functions sit in a deep descendant', () => {
    const deep = folderIndex(
      map([
        { path: '', folders: ['a'], files: [] },
        { path: 'a', folders: ['a/b'], files: [{ path: 'a/notes.md', functions: [] }] },
        { path: 'a/b', folders: ['a/b/c'], files: [] },
        { path: 'a/b/c', folders: [], files: [{ path: 'a/b/c/deep.ts', functions: fns(2) }] }
      ])
    )
    expect(worldNodes(deep, '').map((n) => n.data.path)).toEqual(['a'])
    expect(worldNodes(deep, 'a').map((n) => n.data.path)).toEqual(['a/b'])
    expect(worldNodes(deep, 'a/b/c').map((n) => n.data.path)).toEqual(['a/b/c/deep.ts'])
  })

  it('keeps folder counts accurate for everything the folder really holds', () => {
    const src = worldNodes(index, '').find((n) => n.data.path === 'src')
    expect(src?.data.kind === 'folder' && src.data.counts).toEqual(subtreeCounts(index, 'src'))
  })

  it('shows nothing at all when no file anywhere has a function', () => {
    const barren = folderIndex(
      map([
        { path: '', folders: ['docs'], files: [{ path: 'package.json', functions: [] }] },
        { path: 'docs', folders: [], files: [{ path: 'docs/readme.md', functions: [] }] }
      ])
    )
    expect(worldNodes(barren, '')).toEqual([])
  })
})

describe('crumbs', () => {
  it('starts at the root and adds one clickable segment per level', () => {
    expect(crumbs('Architect', 'src/ui/panels')).toEqual([
      { label: 'Architect', path: '' },
      { label: 'src', path: 'src' },
      { label: 'ui', path: 'src/ui' },
      { label: 'panels', path: 'src/ui/panels' }
    ])
  })

  it('is just the root at the top level', () => {
    expect(crumbs('Architect', '')).toEqual([{ label: 'Architect', path: '' }])
  })
})

describe('codePositions', () => {
  const nodes = (heights: number[]): CodeNode[] =>
    heights.map((height, i) => ({
      id: `n${i}`,
      data: { kind: 'codefile', name: `n${i}`, path: `n${i}`, functions: [] },
      height
    }))

  it('places every node', () => {
    const at = codePositions(nodes([60, 200, 90, 300, 60]))
    expect(at.size).toBe(5)
  })

  it('is empty for an empty world', () => {
    expect(codePositions([]).size).toBe(0)
  })

  it('never overlaps two cards of very different heights', () => {
    const list = nodes([60, 400, 90, 320, 70, 500, 120, 80, 260])
    const at = codePositions(list)
    const boxes = list.map((n) => {
      const p = at.get(n.id) ?? { x: 0, y: 0 }
      return { x: p.x, y: p.y, w: NODE_W, h: n.height }
    })

    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
        expect(apart).toBe(true)
      }
    }
  })
})

describe('columnsFor', () => {
  it('keeps the world roughly square', () => {
    expect(columnsFor(0)).toBe(1)
    expect(columnsFor(1)).toBe(1)
    expect(columnsFor(4)).toBe(2)
    expect(columnsFor(5)).toBe(3)
    expect(columnsFor(9)).toBe(3)
  })
})

function fn(name: string, line: number, endLine: number, calls: number[] = [], description = ''): FunctionEntry {
  return { name, line, endLine, description, calls: calls.map((to) => ({ file: '', fn: to })) }
}

function entry(path: string, functions: FunctionEntry[]): FileEntry {
  return { path, functions: functions.map((f) => ({ ...f, calls: f.calls.map((c) => ({ ...c, file: path })) })) }
}

function only(file: FileEntry): Map<string, FileEntry> {
  return new Map([[file.path, file]])
}

const chart: FileEntry = entry('src/runner.ts', [
  fn('run', 1, 20, [1, 2]),
  fn('load', 22, 30, [5]),
  fn('execute', 32, 60, [3, 4]),
  fn('step', 62, 70, [5]),
  fn('retry', 72, 90, [4, 3]),
  fn('key', 92, 96),
  fn('report', 100, 400),
  fn('noop', 402, 404)
])

const id = (name: string) => fnNodeId(chart.path, chart.functions.findIndex((f) => f.name === name), name)

describe('fileIndex and worldPath', () => {
  const withFile = map([{ path: 'src', folders: [], files: [chart] }])

  it('finds a file anywhere in the map', () => {
    expect(fileIndex(withFile).get('src/runner.ts')?.functions).toHaveLength(8)
    expect(fileIndex(withFile).get('src/ghost.ts')).toBeUndefined()
  })

  it('accepts a folder world and a file world', () => {
    expect(worldPath(withFile, 'src')).toBe('src')
    expect(worldPath(withFile, 'src/runner.ts')).toBe('src/runner.ts')
  })

  it('falls back to the nearest world that still has code', () => {
    const mixed = map([
      { path: '', folders: ['src', 'docs'], files: [] },
      { path: 'src', folders: [], files: [chart, { path: 'src/types.ts', functions: [] }] },
      { path: 'docs', folders: ['docs/img'], files: [{ path: 'docs/readme.md', functions: [] }] },
      { path: 'docs/img', folders: [], files: [] }
    ])

    expect(worldPath(mixed, 'src/types.ts')).toBe('src')
    expect(worldPath(mixed, 'docs/img')).toBe('')
    expect(worldPath(mixed, 'docs/readme.md')).toBe('')
    expect(worldPath(mixed, 'src/ghost.ts')).toBe('src')
  })

  it('falls back to the root when nothing at all has code', () => {
    const barren = map([{ path: '', folders: [], files: [{ path: 'readme.md', functions: [] }] }])
    expect(worldPath(barren, 'readme.md')).toBe('')
    expect(worldPath(barren, '')).toBe('')
  })
})

describe('hangingIndent', () => {
  it('hangs a wrapped line past the indent it started at', () => {
    expect(hangingIndent('const a = 1')).toBe(2)
    expect(hangingIndent('  if (ready) return')).toBe(4)
    expect(hangingIndent('      const merged = await gather()')).toBe(8)
  })

  it('measures a tab as one tab stop', () => {
    expect(hangingIndent('\tif (ready) return')).toBe(4)
    expect(hangingIndent('\t\tif (ready) return')).toBe(6)
    expect(hangingIndent('\t  mixed')).toBe(6)
  })

  it('handles a line that is empty or all whitespace', () => {
    expect(hangingIndent('')).toBe(2)
    expect(hangingIndent('    ')).toBe(6)
  })
})

describe('function node size', () => {
  const at = (description: string) =>
    heightOf({
      kind: 'codefn',
      name: 'run',
      path: 'a.ts',
      line: 1,
      endLine: 900,
      description,
      calls: [],
      callers: [],
      external: false
    })

  it('ignores the line span now that the card carries no source', () => {
    expect(at('')).toBe(FN_BASE_H)
    expect(
      heightOf({ kind: 'codefn', name: 'run', path: 'a.ts', line: 1, endLine: 1, description: '', calls: [], callers: [], external: false })
    ).toBe(FN_BASE_H)
  })

  it('adds one row for a description', () => {
    expect(at('Runs it.') - at('')).toBe(FN_DESC_H)
  })

  it('stays close to a file card and wider than one', () => {
    const fnWidth = widthOf({
      kind: 'codefn',
      name: 'run',
      path: 'a.ts',
      line: 1,
      endLine: 2,
      description: '',
      calls: [],
      callers: [],
      external: false
    })
    expect(fnWidth).toBe(FN_NODE_W)
    expect(fnWidth).toBeGreaterThan(NODE_W)
    expect(fnWidth).toBeLessThan(NODE_W * 1.5)
    expect(widthOf({ kind: 'folder', name: 'src', path: 'src', counts: { files: 0, functions: 0 } })).toBe(NODE_W)
  })
})

describe('functionNodes', () => {
  it('gives every function a unique id and its own height', () => {
    const nodes = functionNodes(chart, only(chart))
    expect(nodes).toHaveLength(8)
    expect(new Set(nodes.map((n) => n.id)).size).toBe(8)
    expect(nodes.every((n) => n.height === heightOf(n.data))).toBe(true)
  })

  it('reverses calls into callers, ignoring self recursion', () => {
    const callersOf = (name: string) => {
      const data = functionNodes(chart, only(chart)).find((n) => n.data.name === name)?.data
      return data?.kind === 'codefn' ? data.callers.map((c) => c.name) : null
    }
    expect(callersOf('step')).toEqual(['execute', 'retry'])
    expect(callersOf('retry')).toEqual(['execute'])
    expect(callersOf('run')).toEqual([])
  })

  it('keeps distinct ids for two functions sharing a name', () => {
    const dup = entry('a.ts', [fn('go', 1, 2), fn('go', 4, 5)])
    expect(new Set(functionNodes(dup, only(dup)).map((n) => n.id)).size).toBe(2)
  })

  it('keeps callers apart for two functions sharing a name', () => {
    const dup = entry('a.ts', [fn('visit', 1, 2), fn('visit', 4, 5), fn('a', 7, 8, [0]), fn('b', 10, 11, [1])])
    const callers = functionNodes(dup, only(dup)).map((n) => (n.data.kind === 'codefn' ? n.data.callers.map((c) => c.name) : null))
    expect(callers).toEqual([['a'], ['b'], [], []])
  })
})

describe('functionEdges', () => {
  it('draws one edge per resolved call, caller to callee', () => {
    const links = functionEdges(chart, only(chart))
    expect(links.map((l) => [l.source, l.target])).toEqual([
      [id('run'), id('load')],
      [id('run'), id('execute')],
      [id('load'), id('key')],
      [id('execute'), id('step')],
      [id('execute'), id('retry')],
      [id('step'), id('key')],
      [id('retry'), id('step')]
    ])
  })

  it('points an edge at the called index, not the first function with that name', () => {
    const dup = entry('a.ts', [fn('parse', 1, 1), fn('parse', 2, 2), fn('parse', 3, 6), fn('main', 8, 10, [2])])
    const links = functionEdges(dup, only(dup))
    expect(links.map((l) => [l.source, l.target])).toEqual([
      [fnNodeId('a.ts', 3, 'main'), fnNodeId('a.ts', 2, 'parse')]
    ])
  })

  it('omits the self edge of a recursive function', () => {
    expect(functionEdges(chart, only(chart)).some((l) => l.source === l.target)).toBe(false)
    const loop = entry('a.ts', [fn('loop', 1, 9, [0])])
    expect(functionEdges(loop, only(loop))).toEqual([])
  })

  it('drops a call that names nothing in this file, and never repeats an edge', () => {
    const file = entry('a.ts', [fn('go', 1, 5, [9, 1, 1]), fn('stop', 7, 9)])
    const links = functionEdges(file, only(file))
    expect(links).toHaveLength(1)
    expect(links[0]?.target).toBe(fnNodeId('a.ts', 1, 'stop'))
  })

  it('has a unique id per edge', () => {
    const links = functionEdges(chart, only(chart))
    expect(new Set(links.map((l) => l.id)).size).toBe(links.length)
  })
})

describe('callPositions', () => {
  it('places callers above their callees', () => {
    const nodes = functionNodes(chart, only(chart))
    const at = callPositions(nodes, functionEdges(chart, only(chart)))
    const y = (name: string) => at.get(id(name))?.y ?? 0
    expect(y('run')).toBeLessThan(y('execute'))
    expect(y('execute')).toBeLessThan(y('retry'))
    expect(y('retry')).toBeLessThan(y('step'))
    expect(y('step')).toBeLessThan(y('key'))
  })

  it('places isolated functions somewhere real, not on top of each other', () => {
    const nodes = functionNodes(chart, only(chart))
    const at = callPositions(nodes, functionEdges(chart, only(chart)))
    expect(at.size).toBe(8)
    expect(at.get(id('report'))).not.toEqual(at.get(id('noop')))
  })

  it('lays out a world where nothing calls anything', () => {
    const lonely = entry('a.ts', [fn('a', 1, 4), fn('b', 6, 9), fn('c', 11, 14)])
    const nodes = functionNodes(lonely, only(lonely))
    const at = callPositions(nodes, functionEdges(lonely, only(lonely)))
    expect(at.size).toBe(3)
    expect(new Set([...at.values()].map((p) => `${p.x},${p.y}`)).size).toBe(3)
  })

  it('never overlaps two function cards', () => {
    const nodes = functionNodes(chart, only(chart))
    const at = callPositions(nodes, functionEdges(chart, only(chart)))
    const boxes = nodes.map((n) => {
      const p = at.get(n.id) ?? { x: 0, y: 0 }
      return { x: p.x, y: p.y, w: widthOf(n.data), h: n.height }
    })
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
        expect(apart).toBe(true)
      }
    }
  })

  it('is empty for a file with no functions', () => {
    expect(callPositions([], [])).toEqual(new Map())
  })
})

describe('crumbs at the function level', () => {
  it('ends on the file, so every segment above it is a folder', () => {
    expect(crumbs('bot', 'src/actions/windowReport.ts')).toEqual([
      { label: 'bot', path: '' },
      { label: 'src', path: 'src' },
      { label: 'actions', path: 'src/actions' },
      { label: 'windowReport.ts', path: 'src/actions/windowReport.ts' }
    ])
  })

  it('walks back out of the file world one level at a time', () => {
    expect(parentOf('src/actions/windowReport.ts')).toBe('src/actions')
  })
})
