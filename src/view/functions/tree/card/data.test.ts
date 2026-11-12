import { describe, expect, it } from 'vitest'
import type { FunctionList, FunctionRow } from '../../../../../shared/types'
import { cardOf, elsewhereOf } from './data'
import { PROJECT, UNREACHED, outlineOf } from '../outline'

const row = (name: string, file: string): FunctionRow => ({
  file,
  name,
  line: 1,
  lines: 1,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: null,
  importance: 1,
})

const rows = Array.from({ length: 14 }, (_, at) => row(`fn${at}`, `src/${at % 2}.ts`))

const list: FunctionList = {
  tree: {
    starts: [0],
    groups: [{ file: 'cli.ts', reason: 'bin', members: [0] }],
    unreached: rows.slice(1).map((_, at) => at + 1),
    children: rows.map(() => []),
    also: rows.map((_, at) => (at === 2 ? 1 : 0)),
  },
  rows,
  calls: rows.map((_, at) => (at === 1 ? [2, 1] : [])),
  scope: '',
  folders: [],
  owners: {},
}

describe('cardOf', () => {
  const outline = outlineOf(list)

  it('labels the project, a group, the unreached card, a bucket and a function from their counts', () => {
    expect(cardOf(outline, PROJECT, list, 'demo')).toMatchObject({ title: 'demo', notes: ['14 functions'], row: null })
    expect(cardOf(outline, 'g:bin:cli.ts', list, 'demo')).toMatchObject({
      title: 'package.json bin',
      notes: ['cli.ts', '1 function · 1 starting point'],
      count: 1,
    })
    expect(cardOf(outline, UNREACHED, list, 'demo')).toMatchObject({
      title: 'Not reached from a starting point',
      notes: ['13 functions'],
    })
    const [odd = ''] = outline.kids.get(UNREACHED) ?? []
    expect(cardOf(outline, odd, list, 'demo')).toMatchObject({
      title: 'src/1.ts',
      tag: 'file',
      notes: ['7 functions · 0 starting points', '0 calls in · 1 out'],
    })
    expect(cardOf(outline, 'f2', list, 'demo')).toMatchObject({ title: 'fn2', notes: [], at: 2, also: 1, elsewhere: 0 })
    expect(cardOf(outline, 'f1', list, 'demo')).toMatchObject({ elsewhere: 1 })
  })

  it('lists each callee drawn under another card once, never itself or one drawn under this card', () => {
    expect(elsewhereOf(outline, list, 1)).toEqual([2])
    const nested = outlineOf({ ...list, tree: { ...list.tree, unreached: [1], children: rows.map((_, at) => (at === 1 ? [2] : [])) } })
    expect(elsewhereOf(nested, list, 1)).toEqual([])
    expect(elsewhereOf(outline, { calls: [[99]] }, 0)).toEqual([])

    const wide = rows.map((_, at) => (at === 0 ? rows.slice(1).map((_, k) => k + 1) : []))
    const bucketed = outlineOf({ ...list, tree: { ...list.tree, unreached: [], children: wide } })
    expect(bucketed.up.get('f5')).not.toBe('f0')
    expect(elsewhereOf(bucketed, { calls: wide }, 0)).toEqual([])
  })
})
