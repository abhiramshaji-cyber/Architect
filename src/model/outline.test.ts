import { describe, expect, it } from 'vitest'
import type { CodeMap, FunctionEntry } from '../../shared/types'
import { fnNodeId } from './codemap'
import { outlineFor } from './outline'

function fn(name: string, line: number, endLine = line): FunctionEntry {
  return { name, line, endLine, description: '', calls: [] }
}

function mapWith(path: string, functions: FunctionEntry[]): CodeMap {
  return {
    root: '/root',
    scannedAt: 0,
    folders: [{ path: '', folders: [], files: [{ path, functions }] }]
  }
}

describe('outlineFor', () => {
  it('returns entries sorted by line', () => {
    const map = mapWith('a.ts', [fn('b', 10), fn('a', 1), fn('c', 5)])
    expect(outlineFor(map, 'a.ts').map((e) => e.name)).toEqual(['a', 'c', 'b'])
  })

  it('handles a file with no functions', () => {
    expect(outlineFor(mapWith('empty.ts', []), 'empty.ts')).toEqual([])
  })

  it('handles a file not present in the code map', () => {
    expect(outlineFor(mapWith('a.ts', [fn('a', 1)]), 'missing.ts')).toEqual([])
  })

  it('handles a code map that has not loaded yet', () => {
    expect(outlineFor(undefined, 'a.ts')).toEqual([])
    expect(outlineFor(null, 'a.ts')).toEqual([])
  })

  it('keeps a very long symbol name intact', () => {
    const long = 'x'.repeat(500)
    const map = mapWith('a.ts', [fn(long, 1)])
    expect(outlineFor(map, 'a.ts')[0]?.name).toHaveLength(500)
  })

  it('keeps nested functions with overlapping ranges stable by line', () => {
    const outer = fn('outer', 1, 20)
    const inner = fn('inner', 5, 10)
    const map = mapWith('a.ts', [outer, inner])
    expect(outlineFor(map, 'a.ts').map((e) => e.name)).toEqual(['outer', 'inner'])
  })

  it('ids match the graph node id for the same function', () => {
    const map = mapWith('a.ts', [fn('a', 1)])
    expect(outlineFor(map, 'a.ts')[0]?.id).toBe(fnNodeId('a.ts', 0, 'a'))
  })
})
