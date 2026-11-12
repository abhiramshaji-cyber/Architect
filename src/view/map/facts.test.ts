import { describe, expect, it } from 'vitest'
import type { FunctionRow } from '../../../shared/types'
import { factsFor } from './facts'
import { nest } from './layout/nest'
import type { Facts } from './modes/shade'

const row = (over: Partial<FunctionRow>): FunctionRow => ({
  file: 'a/one.ts',
  name: 'x',
  line: 1,
  lines: 1,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: null,
  importance: 1,
  ...over,
})

const rows = [
  row({ name: 'main', lines: 20, importance: 4, fanIn: 2, entry: { reason: 'bin', file: 'package.json' } }),
  row({ name: 'inner', line: 2, lines: 5 }),
  row({ file: 'a/two.ts', name: 'dead', lines: 3 }),
]

const facts: Facts = {
  rows,
  unreached: new Set([2]),
  churn: {
    days: 90,
    files: { 'a/one.ts': { commits: 4, added: 10, removed: 2 } },
    functions: { 'a/one.ts:1:main': 3 },
  },
  sessions: new Map([['a/one.ts', [{ session: 's1', at: 0 }]]]),
}

const tree = nest(rows, null, 'demo')
const find = (label: string) => {
  const stack = [tree]
  while (stack.length) {
    const node = stack.pop()
    if (node?.label === label) return node
    stack.push(...(node?.children ?? []))
  }
  throw new Error(label)
}

describe('factsFor', () => {
  it('lists a function with its own lines, start reason, churn and sessions', () => {
    const told = factsFor(find('main'), facts)
    const lines = Object.fromEntries(told.lines)
    expect(told).toMatchObject({ kind: 'function', title: 'main' })
    expect(lines.at).toBe('a/one.ts:1')
    expect(lines.lines).toBe('20 (15 outside nested functions)')
    expect(lines.reached).toBe('starting point, bin in package.json')
    expect(lines.churn).toBe('3 commits in 90 days')
    expect(lines['AI touched']).toBe('1 session')
  })

  it('marks an unreached function and leaves churn out until it arrives', () => {
    const lines = Object.fromEntries(factsFor(find('dead'), { ...facts, churn: null }).lines)
    expect(lines.reached).toBe('unreached')
    expect(lines.churn).toBeUndefined()
    expect(lines['AI touched']).toBe('no')
  })

  it('sums a file and a group', () => {
    const file = Object.fromEntries(factsFor(find('one.ts'), facts).lines)
    expect(file.lines).toBe('20 in 2 functions')
    expect(file.churn).toBe('4 commits, +10 -2 in 90 days')
    const group = factsFor(find('a'), facts)
    expect(group.kind).toBe('top level folder')
    expect(Object.fromEntries(group.lines).unreached).toBe('1 function, 33%')
    expect(Object.fromEntries(group.lines).files).toBe('2')
  })
})
