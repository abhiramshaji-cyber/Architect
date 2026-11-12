import { describe, expect, it } from 'vitest'
import type { Architecture, CodeMap, Touch } from '../../shared/types'
import type { Lines } from '../git/blame'
import { latestIn, recencyOf } from '.'

const old: Touch = { at: 1000, sha: 'a', subject: 'old' }
const mid: Touch = { at: 2000, sha: 'b', subject: 'mid' }
const late: Touch = { at: 3000, sha: 'c', subject: 'late' }

const fn = (name: string, line: number, endLine: number) => ({ name, line, endLine, description: '', calls: [] })

const map = {
  root: '/r',
  folders: [
    {
      path: 'src',
      folders: [],
      files: [
        { path: 'src/a.ts', functions: [fn('first', 1, 2), fn('second', 3, 4)] },
        { path: 'src/b.ts', functions: [fn('fresh', 1, 1)] },
        { path: 'lib/c.ts', functions: [fn('used', 1, 1)] },
      ],
    },
  ],
} as unknown as CodeMap

const blamed = new Map<string, Lines>([
  ['src/a.ts', [old, old, mid, late]],
  ['src/b.ts', 'uncommitted'],
  ['lib/c.ts', [mid]],
])

describe('latestIn', () => {
  it('takes the newest line in the range and clamps past the end', () => {
    expect(latestIn([old, late, mid], 1, 2)).toBe(late)
    expect(latestIn([old, mid], 2, 99)).toBe(mid)
    expect(latestIn([old, 'uncommitted'], 1, Infinity)).toBe('uncommitted')
  })

  it('has nothing for an unknown file, an empty file or a range outside it', () => {
    expect(latestIn(undefined, 1, 2)).toBeUndefined()
    expect(latestIn([], 1, 2)).toBeUndefined()
    expect(latestIn([old], 5, 9)).toBeUndefined()
  })
})

describe('recencyOf', () => {
  it('gives each function the newest change in its own lines', () => {
    const { functions } = recencyOf(map, null, blamed)
    expect(functions).toEqual({
      'src/a.ts:1:first': old,
      'src/a.ts:3:second': late,
      'src/b.ts:1:fresh': 'uncommitted',
      'lib/c.ts:1:used': mid,
    })
  })

  it('gives each component the newest change across owned files and covered functions', () => {
    const architecture: Architecture = {
      title: 't',
      summary: 's',
      components: [
        { id: 'core', purpose: '', owns: ['src/a.ts'], covers: ['lib/c.ts#used'] },
        { id: 'edge', purpose: '', owns: ['src/**'] },
        { id: 'flow', purpose: '', owns: [], covers: ['lib/c.ts#used', 'src/missing.ts#gone'] },
        { id: 'outside', purpose: '', owns: [] },
      ],
      edges: [],
      forbidden: [],
      packages: [],
    }
    expect(recencyOf(map, architecture, blamed).components).toEqual({ core: late, edge: 'uncommitted', flow: mid })
  })
})
