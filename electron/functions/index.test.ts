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
    expect(functionsOf(mapOf([]), new Set())).toEqual([])
    expect(functionsOf(mapOf([{ path: 'a.ts', functions: [fn('loadConfig')] }]), new Set())).toEqual([
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
        summary: 'Loads the config. Starting point of the app.',
      },
    ])
  })

  it('fills every row, keeps duplicate names apart and survives a cycle', () => {
    const map = mapOf([
      { path: 'a.ts', imports: ['b.ts'], functions: [fn('run', [{ file: 'b.ts', fn: 0 }]), fn('run')] },
      { path: 'b.ts', imports: ['a.ts'], functions: [fn('ping', [{ file: 'b.ts', fn: 1 }]), fn('pong', [{ file: 'b.ts', fn: 0 }])] },
    ])
    const rows = functionsOf(map, new Set())
    expect(rows).toHaveLength(4)
    expect(rows.every((row) => row.summary !== '' && row.importance >= 1 && row.importance <= 5)).toBe(true)
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
    const rows = functionsOf(mapOf(files), new Set())
    const spent = performance.now() - started
    expect(rows).toHaveLength(1500)
    expect(new Set(rows.map((row) => row.importance)).size).toBeGreaterThan(1)
    expect(spent).toBeLessThan(250)
  })
})
