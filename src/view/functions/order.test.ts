import { describe, expect, it } from 'vitest'
import type { FunctionRow } from '../../../shared/types'
import { arrange } from './order'

const row = (over: Partial<FunctionRow>): FunctionRow => ({
  file: 'a.ts',
  name: 'x',
  line: 1,
  lines: 1,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: false,
  importance: 1,
  summary: '',
  ...over,
})

const rows = [
  row({
    name: 'small',
    lines: 2,
    fanIn: 9,
    importance: 2, summary: 'Adds numbers.',
  }),
  row({
    name: 'core',
    lines: 40,
    fanIn: 1,
    importance: 5, summary: 'Runs the app.',
  }),
  row({
    name: 'bigcore',
    lines: 80,
    fanIn: 0,
    file: 'src/main.ts',
    importance: 5, summary: 'Starts up.',
  }),
  row({ name: 'loose', lines: 300, fanIn: 3, importance: 2, summary: 'Spare.' }),
]

const names = (placed: ReturnType<typeof arrange>) => placed.map((p) => p.row.name)

describe('arrange', () => {
  it('orders by importance, then callers, then lines', () => {
    expect(names(arrange(rows, 'importance', ''))).toEqual(['core', 'bigcore', 'small', 'loose'])
  })

  it('sorts by lines and by name', () => {
    expect(names(arrange(rows, 'lines', ''))).toEqual(['loose', 'bigcore', 'core', 'small'])
    expect(names(arrange(rows, 'name', ''))).toEqual(['bigcore', 'core', 'loose', 'small'])
  })

  it('sorts by most recent change, uncommitted first and unknown last', () => {
    const changes = {
      'a.ts:1:small': { at: 5, sha: 'b', subject: '' },
      'a.ts:1:core': { at: 1, sha: 'a', subject: '' },
      'src/main.ts:1:bigcore': 'uncommitted' as const,
    }
    expect(names(arrange(rows, 'recent', '', changes))).toEqual(['bigcore', 'small', 'core', 'loose'])
    expect(names(arrange(rows, 'recent', ''))).toEqual(['bigcore', 'core', 'loose', 'small'])
  })

  it('filters by name, path or summary, ignoring case and surrounding space', () => {
    expect(names(arrange(rows, 'name', '  RUNS '))).toEqual(['core'])
    expect(names(arrange(rows, 'name', 'src/'))).toEqual(['bigcore'])
    expect(names(arrange(rows, 'name', 'lo'))).toEqual(['loose'])
    expect(arrange(rows, 'name', 'nothing here')).toEqual([])
  })

  it('gives every row a distinct key even when a file repeats a name on one line', () => {
    const twins = [row({ name: 'dup' }), row({ name: 'dup' })]
    const keys = arrange(twins, 'name', '').map((p) => p.key)
    expect(new Set(keys).size).toBe(2)
  })
})
