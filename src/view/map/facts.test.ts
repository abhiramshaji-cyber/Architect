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
  untraced: null,
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
  unknown: new Set(),
  churn: {
    days: 90,
    files: { 'a/one.ts': { commits: 4, added: 10, removed: 2 } },
    functions: { 'a/one.ts:1:main': 3 },
  },
  sessions: new Map([['a/one.ts', [{ session: 's1', at: 0 }]]]),
  recorded: 12,
  style: null,
}

const tree = nest(rows, [], null, 'demo')
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
    expect(lines['AI touched']).toBe('no session in the last 12 recorded changes')
  })

  it('sums a file and a group', () => {
    const file = Object.fromEntries(factsFor(find('one.ts'), facts).lines)
    expect(file.lines).toBe('20, 2 functions')
    expect(file.churn).toBe('4 commits, +10 -2 in 90 days')
    const group = factsFor(find('a'), facts)
    expect(group.kind).toBe('top level folder')
    expect(Object.fromEntries(group.lines).unreached).toBe('1 function, 33%')
    expect(Object.fromEntries(group.lines).files).toBe('2')
  })

  it('describes the lines outside every function', () => {
    const sized = nest(rows, [{ path: 'a/one.ts', lines: 26, code: true }], null, 'demo')
    const rest = sized.children[0]?.children[0]?.children
      .find((c) => c.kind === 'file' && c.path === 'a/one.ts')
      ?.children.find((c) => c.kind === 'rest')
    const told = rest ? factsFor(rest, facts) : null
    expect(told?.kind).toBe('lines outside functions')
    expect(Object.fromEntries(told?.lines ?? []).lines).toBe('6 in a/one.ts not inside any function')
  })

  it('lists the failing rules of a file and the score of a group', () => {
    const style = new Map([
      [
        'a/one.ts',
        [{ rule: 'lines' as const, line: 201, message: '250 lines, the limit is 200', grandfathered: true }],
      ],
      ['a/two.ts', []],
    ])
    const withStyle = { ...facts, style }
    expect(Object.fromEntries(factsFor(find('main'), withStyle).lines)['fails lines']).toBe(
      'line 201: 250 lines, the limit is 200, allowed only by a grandfathered limit',
    )
    expect(Object.fromEntries(factsFor(find('two.ts'), withStyle).lines).style).toBe('passes every rule')
    const group = Object.fromEntries(factsFor(find('a'), withStyle).lines)
    expect(group['style score']).toBe('50%, 1 of 2 files pass')
    expect(group['passing per rule']).toBe('lines 1, files 2, names 2, jobs 2')
    expect(Object.fromEntries(factsFor(find('two.ts'), { ...facts, style: new Map() }).lines).style).toBe(
      'not checked, the rules skip this file',
    )
    expect(Object.fromEntries(factsFor(find('a'), { ...facts, style: new Map() }).lines).style).toBe('no checked files')
    expect(factsFor(find('a'), facts).lines.some(([name]) => name.startsWith('style'))).toBe(false)
  })
})
