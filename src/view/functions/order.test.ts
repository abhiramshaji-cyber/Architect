import { describe, expect, it } from 'vitest'
import type { FunctionRow, FunctionsReport } from '../../../shared/types'
import { arrange, settled } from './order'

const row = (over: Partial<FunctionRow>): FunctionRow => ({
  file: 'a.ts',
  name: 'x',
  line: 1,
  lines: 1,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: false,
  rank: null,
  ...over,
})

const rows = [
  row({
    name: 'small',
    lines: 2,
    fanIn: 9,
    rank: { importance: 2, summary: 'Adds numbers.' },
  }),
  row({
    name: 'core',
    lines: 40,
    fanIn: 1,
    rank: { importance: 5, summary: 'Runs the app.' },
  }),
  row({
    name: 'bigcore',
    lines: 80,
    fanIn: 0,
    file: 'src/main.ts',
    rank: { importance: 5, summary: 'Starts up.' },
  }),
  row({ name: 'loose', lines: 300, fanIn: 3 }),
]

const names = (placed: ReturnType<typeof arrange>) => placed.map((p) => p.row.name)

describe('arrange', () => {
  it('orders by importance, then by lines, with unranked rows last once ranking is settled', () => {
    expect(names(arrange(rows, 'importance', true, ''))).toEqual(['bigcore', 'core', 'small', 'loose'])
  })

  it('uses the provisional order of callers then lines while ranking is not settled', () => {
    expect(names(arrange(rows, 'importance', false, ''))).toEqual(['small', 'loose', 'core', 'bigcore'])
  })

  it('sorts by lines and by name', () => {
    expect(names(arrange(rows, 'lines', true, ''))).toEqual(['loose', 'bigcore', 'core', 'small'])
    expect(names(arrange(rows, 'name', true, ''))).toEqual(['bigcore', 'core', 'loose', 'small'])
  })

  it('filters by name, path or summary, ignoring case and surrounding space', () => {
    expect(names(arrange(rows, 'name', true, '  RUNS '))).toEqual(['core'])
    expect(names(arrange(rows, 'name', true, 'src/'))).toEqual(['bigcore'])
    expect(names(arrange(rows, 'name', true, 'lo'))).toEqual(['loose'])
    expect(arrange(rows, 'name', true, 'nothing here')).toEqual([])
  })

  it('gives every row a distinct key even when a file repeats a name on one line', () => {
    const twins = [row({ name: 'dup' }), row({ name: 'dup' })]
    const keys = arrange(twins, 'name', true, '').map((p) => p.key)
    expect(new Set(keys).size).toBe(2)
  })
})

describe('settled', () => {
  const report = (over: Partial<FunctionsReport>): FunctionsReport => ({
    root: '/r',
    rows,
    done: 2,
    total: 2,
    failed: 0,
    failure: null,
    ...over,
  })

  it('is settled only when every file is done and something was ranked', () => {
    expect(settled(report({}))).toBe(true)
    expect(settled(report({ done: 1 }))).toBe(false)
    expect(settled(report({ rows: [row({})] }))).toBe(false)
  })
})
