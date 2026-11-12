import { describe, expect, it } from 'vitest'
import type { Churn } from '../../../shared/recency'
import type { CodeMap, FunctionEntry } from '../../../shared/types'
import { rank } from './rank'
import { axis } from './scale'

const fn = (name: string, line: number, endLine: number): FunctionEntry => ({ name, line, endLine, description: '', calls: [] })

const map: CodeMap = {
  root: '/r',
  scannedAt: 0,
  folders: [
    { path: '', folders: ['src'], files: [{ path: 'a.ts', lines: 100, functions: [fn('big', 1, 80), fn('small', 81, 90)] }] },
    { path: 'src', folders: [], files: [{ path: 'src/b.ts', lines: 50, functions: [] }, { path: 'src/c.md', functions: [] }] },
  ],
}

const churn: Churn = { days: 90, files: { 'a.ts': { commits: 2, added: 10, removed: 3 }, 'src/b.ts': { commits: 4, added: 1, removed: 1 }, 'gone.ts': { commits: 9, added: 0, removed: 0 } }, functions: { 'a.ts:81:small': 3, 'a.ts:1:big': 1 } }

describe('rank', () => {
  it('scores files by lines over the most lines times commits over the most commits, breaking ties by commits', () => {
    expect(rank(map, churn, 'files').items.map(({ key, score, commits, added }) => ({ key, score, commits, added }))).toEqual([
      { key: 'src/b.ts', score: 0.5, commits: 4, added: 1 },
      { key: 'a.ts', score: 0.5, commits: 2, added: 10 },
      { key: 'src/c.md', score: 0, commits: 0, added: 0 },
    ])
  })

  it('returns the most lines and most commits it divided by', () => {
    expect(rank(map, churn, 'files').most).toEqual({ lines: 100, commits: 4 })
    expect(rank(map, churn, 'functions').most).toEqual({ lines: 80, commits: 3 })
  })

  it('scores functions by their own span and their own commits', () => {
    expect(rank(map, churn, 'functions').items.map(({ name, lines, commits, score }) => ({ name, lines, commits, score }))).toEqual([
      { name: 'big', lines: 80, commits: 1, score: 1 / 3 },
      { name: 'small', lines: 10, commits: 3, score: 0.125 },
    ])
  })

  it('breaks full ties by lines and then by key', () => {
    const flat: CodeMap = { root: '/r', scannedAt: 0, folders: [{ path: '', folders: [], files: ['b', 'a', 'c'].map((path, at) => ({ path, lines: at === 2 ? 5 : 1, functions: [] })) }] }
    expect(rank(flat, { days: 9, files: {}, functions: {} }, 'files').items.map((item) => item.key)).toEqual(['c', 'a', 'b'])
  })

  it('scores everything zero when nothing changed or nothing has lines', () => {
    expect(rank(map, { days: 30, files: {}, functions: {} }, 'files').items.every((item) => item.score === 0)).toBe(true)
    expect(rank({ root: '/r', scannedAt: 0, folders: [] }, churn, 'functions')).toEqual({ items: [], most: { lines: 0, commits: 0 } })
  })
})

describe('axis', () => {
  it('ticks at zero and each power of ten up to the most', () => {
    expect(axis(0).ticks).toEqual([0])
    expect(axis(9).ticks).toEqual([0, 1])
    expect(axis(1000).ticks).toEqual([0, 1, 10, 100, 1000])
  })

  it('places values on a log scale clamped to the plot, and never loops on a bad maximum', () => {
    const at = axis(99).at
    expect([at(0), at(99), at(9), at(500), at(-3)]).toEqual([0, 1, 0.5, 1, 0])
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5]) expect(axis(bad)).toMatchObject({ ticks: [0] })
    expect(axis(Number.NaN).at(10)).toBe(0)
  })
})
