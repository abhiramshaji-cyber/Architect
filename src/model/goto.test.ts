import { describe, expect, it } from 'vitest'
import type { CallRef, CodeMap, FunctionEntry } from '../../shared/types'
import { gotoSymbol } from './goto'

function fn(name: string, line: number, calls: CallRef[] = []): FunctionEntry {
  return { name, line, endLine: line, description: '', calls }
}

const map: CodeMap = {
  root: '/repo',
  scannedAt: 0,
  folders: [
    {
      path: '',
      folders: [],
      files: [
        {
          path: 'a.ts',
          functions: [
            fn('run', 1, [{ file: 'a.ts', fn: 1 }]),
            fn('helper', 5, [{ file: 'b.ts', fn: 0 }]),
            fn('recurse', 10, [{ file: 'a.ts', fn: 2 }])
          ]
        },
        {
          path: 'b.ts',
          functions: [fn('shared', 1, []), fn('shared', 8, [])]
        },
        {
          path: 'c.ts',
          functions: [fn('caller', 1, [{ file: 'a.ts', fn: 1 }])]
        }
      ]
    }
  ]
}

describe('gotoSymbol', () => {
  it('reports the map has not loaded', () => {
    expect(gotoSymbol(undefined, { file: 'a.ts', index: 0 })).toEqual({ status: 'no-map' })
    expect(gotoSymbol(null, { file: 'a.ts', index: 0 })).toEqual({ status: 'no-map' })
  })

  it('reports an unresolved target when the file is missing', () => {
    expect(gotoSymbol(map, { file: 'missing.ts', index: 0 })).toEqual({ status: 'unresolved' })
  })

  it('reports an unresolved target when the index is stale', () => {
    expect(gotoSymbol(map, { file: 'a.ts', index: 9 })).toEqual({ status: 'unresolved' })
  })

  it('finds the definition and every caller across files', () => {
    const result = gotoSymbol(map, { file: 'a.ts', index: 1 })
    expect(result.status).toBe('found')
    if (result.status !== 'found') return
    expect(result.def).toEqual({ file: 'a.ts', index: 1, name: 'helper', line: 5, endLine: 5 })
    expect(result.callers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'a.ts', index: 0, name: 'run' }),
        expect.objectContaining({ file: 'c.ts', index: 0, name: 'caller' })
      ])
    )
    expect(result.callers).toHaveLength(2)
  })

  it('says a function with no callers has none, explicitly', () => {
    const result = gotoSymbol(map, { file: 'a.ts', index: 2 })
    expect(result.status).toBe('found')
    if (result.status !== 'found') return
    expect(result.callers).toEqual([])
  })

  it('does not conflate two definitions that share a name', () => {
    const first = gotoSymbol(map, { file: 'b.ts', index: 0 })
    const second = gotoSymbol(map, { file: 'b.ts', index: 1 })
    expect(first.status).toBe('found')
    expect(second.status).toBe('found')
    if (first.status !== 'found' || second.status !== 'found') return
    expect(first.def.line).toBe(1)
    expect(second.def.line).toBe(8)
  })

  it('excludes a self call from both callers and callees', () => {
    const result = gotoSymbol(map, { file: 'a.ts', index: 2 })
    expect(result.status).toBe('found')
    if (result.status !== 'found') return
    expect(result.callees).toEqual([])
  })

  it('dedupes a caller that calls the target more than once', () => {
    const withDouble: CodeMap = {
      root: '/repo',
      scannedAt: 0,
      folders: [
        {
          path: '',
          folders: [],
          files: [
            { path: 'x.ts', functions: [fn('target', 1), fn('both', 3, [{ file: 'x.ts', fn: 0 }, { file: 'x.ts', fn: 0 }])] }
          ]
        }
      ]
    }
    const result = gotoSymbol(withDouble, { file: 'x.ts', index: 0 })
    expect(result.status).toBe('found')
    if (result.status !== 'found') return
    expect(result.callers).toHaveLength(1)
  })

  it('finds the callees of a function', () => {
    const result = gotoSymbol(map, { file: 'a.ts', index: 0 })
    expect(result.status).toBe('found')
    if (result.status !== 'found') return
    expect(result.callees).toEqual([{ file: 'a.ts', index: 1, name: 'helper', line: 5, endLine: 5 }])
  })
})
