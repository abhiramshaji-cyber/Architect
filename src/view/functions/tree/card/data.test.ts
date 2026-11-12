import { describe, expect, it } from 'vitest'
import type { FunctionList, FunctionRow } from '../../../../../shared/types'
import { cardOf, elsewhereOf } from './data'
import { PROJECT, UNKNOWN, UNREACHED, outlineOf } from '../outline'

const row = (name: string, file: string): FunctionRow => ({
  file,
  name,
  line: 1,
  lines: 1,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: null,
  untraced: null,
  importance: 1,
})

const rows = Array.from({ length: 14 }, (_, at) => row(`fn${at}`, `src/${at % 2}.ts`))

const list: FunctionList = {
  tree: {
    starts: [0],
    groups: [{ file: 'cli.ts', reason: 'bin', members: [0] }],
    unknown: [],
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
    expect(cardOf(outline, PROJECT, list, 'demo')).toMatchObject({ title: 'demo', notes: ['14 functions'], row: null, pill: '14 functions' })
    expect(cardOf(outline, 'g:bin:cli.ts', list, 'demo')).toMatchObject({
      title: 'package.json bin',
      notes: ['cli.ts', '1 function · 1 starting point'],
      count: 1,
    })
    expect(cardOf(outline, UNREACHED, list, 'demo')).toMatchObject({
      title: 'Not reached from a starting point',
      notes: ['13 functions'],
      pill: '13 functions',
    })
    const [odd = ''] = outline.kids.get(UNREACHED) ?? []
    expect(cardOf(outline, odd, list, 'demo')).toMatchObject({
      title: 'src/1.ts',
      tag: 'file',
      notes: ['7 functions · 0 starting points', '0 calls in · 1 out'],
      pill: '7 functions',
    })
    expect(cardOf(outline, 'f2', list, 'demo')).toMatchObject({ title: 'fn2', notes: ['no callers'], at: 2, also: 1, elsewhere: 0, pill: '0 callers' })
    expect(cardOf(outline, 'f2', { ...list, rows: rows.map((one, at) => (at === 2 ? { ...one, fanIn: 1 } : one)) }, 'demo').pill).toBe('1 caller')
    expect(cardOf(outline, 'f2', { ...list, rows: rows.map((one, at) => (at === 2 ? { ...one, outsideCallers: 5 } : one)) }, 'demo').pill).toBe('0 callers +5 outside')
    expect(cardOf(outline, 'f1', list, 'demo')).toMatchObject({ elsewhere: 1 })
  })

  it('states where an unreached or untraced function is and what its callers are, never for a reached one', () => {
    const marked = rows.map((one, at) => ({ ...one, fanIn: at === 2 ? 2 : 0, untraced: at === 3 ? ('value' as const) : at === 5 ? ('load' as const) : null }))
    const tree = { ...list.tree, unknown: [3, 5, 7], unreached: [1, 2] }
    const split = outlineOf({ ...list, rows: marked, tree })
    const notes = (at: number, over: Partial<FunctionRow> = {}) =>
      cardOf(split, `f${at}`, { ...list, rows: marked.map((one, k) => (k === at ? { ...one, ...over } : one)), tree }, 'demo').notes
    expect(notes(1)).toEqual(['no callers'])
    expect(notes(2)).toEqual(['2 callers, none reached'])
    expect(notes(3)).toEqual(['used as a value'])
    expect(notes(5)).toEqual(['called when its file loads'])
    expect(notes(7, { fanIn: 1 })).toEqual(['1 caller, reach unknown'])
    expect(notes(0)).toEqual([])
    expect(cardOf(split, UNKNOWN, { ...list, rows: marked, tree }, 'demo')).toMatchObject({ title: 'Reach unknown' })
    expect(split.kids.get(PROJECT)).toEqual(['g:bin:cli.ts', UNKNOWN, UNREACHED])
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
