import { describe, expect, it } from 'vitest'
import type { FunctionRow, FunctionTree, HistoryEntry } from '../../../../shared/types'
import { nest } from '../layout/nest'
import { gather, sessionsOf, unreachedOf } from './gather'
import { churnTop, type Facts, leafValues, shade } from './shade'
import { fillOf, rgbOf } from './palette'

const row = (over: Partial<FunctionRow>): FunctionRow => ({
  file: 'a.ts',
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

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  id: 'e',
  root: '/r',
  at: 1,
  source: 'code',
  added: [],
  changed: [],
  removed: [],
  ...over,
})

const rows = [
  row({ file: 'a/one.ts', name: 'top', importance: 5, lines: 30 }),
  row({ file: 'a/one.ts', name: 'low', line: 40, lines: 10 }),
  row({ file: 'b/two.ts', name: 'lone', importance: 3, lines: 20 }),
]

const facts = (over: Partial<Facts> = {}): Facts => ({
  rows,
  unreached: new Set([2]),
  churn: { days: 90, files: {}, functions: { 'a/one.ts:1:top': 7, 'b/two.ts:1:lone': 1 } },
  sessions: new Map([['b/two.ts', [{ session: 's', at: 1 }]]]),
  recorded: 1,
  ...over,
})

describe('unreachedOf', () => {
  it('collects every function under the unreached roots once, even across a cycle', () => {
    const tree: FunctionTree = { starts: [0], groups: [], unreached: [1], children: [[], [2], [1, 3], []], also: [] }
    expect([...unreachedOf(tree)].sort()).toEqual([1, 2, 3])
  })
})

describe('sessionsOf', () => {
  it('keeps code files a session added or changed, newest first', () => {
    const found = sessionsOf([
      entry({ session: 's1', at: 1, changed: ['codefile:a.ts', 'folder:src'] }),
      entry({ session: 's2', at: 5, added: ['codefile:a.ts'] }),
      entry({ session: 's2', at: 5, added: ['codefile:a.ts'] }),
      entry({ at: 9, changed: ['codefile:b.ts'] }),
      entry({ session: 's3', removed: ['codefile:c.ts'] }),
      entry({ source: 'contract', session: 's4', changed: ['codefile:d.ts'] }),
    ])
    expect([...found.keys()]).toEqual(['a.ts'])
    expect(found.get('a.ts')).toEqual([
      { session: 's2', at: 5 },
      { session: 's1', at: 1 },
    ])
  })
})

describe('leafValues', () => {
  it('scales importance, unreached, touched and churn into 0 to 1', () => {
    expect(leafValues('importance', facts(), 0)).toEqual([1, 0, 0.5])
    expect(leafValues('unreached', facts(), 0)).toEqual([0, 0, 1])
    expect(leafValues('touched', facts(), 0)).toEqual([0, 0, 1])
    const churn = leafValues('churn', facts(), 7)
    expect(churn[0]).toBe(1)
    expect(churn[1]).toBe(0)
    expect(churn[2]).toBeCloseTo(Math.log1p(1) / Math.log1p(7))
  })

  it('has no churn colour before churn arrives and all zero when nothing changed', () => {
    expect(leafValues('churn', facts({ churn: null }), 7)).toEqual([null, null, null])
    expect(leafValues('churn', facts({ churn: { days: 90, files: {}, functions: {} } }), 0)).toEqual([0, 0, 0])
  })

  it('scales churn for a very large project without overflowing the call stack', () => {
    const many = Array.from({ length: 200_000 }, (_, at) => row({ file: `f${at}.ts`, line: 1, name: 'x' }))
    const functions = Object.fromEntries(many.map((r, at) => [`${r.file}:1:x`, at % 50]))
    const big = facts({ rows: many, churn: { days: 90, files: {}, functions } })
    const values = leafValues('churn', big, churnTop(nest(many, [], null, 'demo'), big))
    expect(values[49]).toBe(1)
    expect(values[0]).toBe(0)
  })
})

describe('shade', () => {
  it('weights each group by the lines under it', () => {
    const tree = nest(rows, [], null, 'demo')
    const values = shade(tree, 'importance', facts())
    const a = tree.children.find((c) => c.label === 'a')
    const b = tree.children.find((c) => c.label === 'b')
    expect(values.get(a?.id ?? '')).toBeCloseTo(30 / 40)
    expect(values.get(b?.id ?? '')).toBeCloseTo(0.5)
    expect(values.get(tree.id)).toBeCloseTo(40 / 60)
  })

  it('leaves every tile without a value while churn is unknown', () => {
    const tree = nest(rows, [], null, 'demo')
    expect([...shade(tree, 'churn', facts({ churn: null })).values()].every((v) => v === null)).toBe(true)
  })
})

describe('shade outside functions', () => {
  const tree = nest(
    [],
    [
      { path: 'a/types.ts', lines: 300 },
      { path: 'b/two.ts', lines: 20 },
    ],
    null,
    'demo',
  )
  const restOf = (file: string) => {
    const group = tree.children.find((c) => c.label === file.split('/')[0])
    return group?.children[0]?.children[0]?.children[0]?.id ?? ''
  }

  it('colours a file with no functions by its sessions and its file churn', () => {
    const touched = shade(tree, 'touched', facts({ sessions: new Map([['a/types.ts', [{ session: 's', at: 1 }]]]) }))
    expect(touched.get(restOf('a/types.ts'))).toBe(1)
    expect(touched.get(restOf('b/two.ts'))).toBe(0)
    const churned = facts({
      churn: {
        days: 90,
        files: { 'a/types.ts': { commits: 99, added: 1, removed: 0 } },
        functions: { 'a/one.ts:1:top': 7 },
      },
    })
    const churn = shade(tree, 'churn', churned)
    expect(churn.get(restOf('a/types.ts'))).toBe(1)
    expect(churn.get(restOf('b/two.ts'))).toBe(0)
    expect(shade(tree, 'churn', facts({ churn: null })).get(restOf('a/types.ts'))).toBeNull()
  })

  it('leaves it uncoloured for importance and unreached', () => {
    expect(shade(tree, 'importance', facts()).get(restOf('a/types.ts'))).toBeNull()
    expect(shade(tree, 'unreached', facts()).get(restOf('a/types.ts'))).toBeNull()
  })
})

describe('churnTop', () => {
  it('sets the scale from tiles on the map only, ignoring busier files without a tile', () => {
    const tree = nest(rows, [{ path: 'a/one.ts', lines: 60 }], null, 'demo')
    const churn = {
      days: 90,
      files: {
        'package-lock.json': { commits: 500, added: 1, removed: 1 },
        'a/one.ts': { commits: 9, added: 1, removed: 0 },
      },
      functions: { 'a/one.ts:1:top': 7 },
    }
    expect(churnTop(tree, facts({ churn }))).toBe(9)
    expect(churnTop(nest(rows, [], null, 'demo'), facts({ churn }))).toBe(7)
    expect(churnTop(tree, facts({ churn: null }))).toBe(0)
  })
})

describe('gather', () => {
  it('collects the rows, the whole unreached bucket and the session files', () => {
    const tree: FunctionTree = { starts: [0], groups: [], unreached: [2], children: [[1], [], []], also: [] }
    const found = gather({ rows, calls: [], tree, scope: '', folders: [], owners: {} }, null, [
      entry({ session: 's', changed: ['codefile:b/two.ts'] }),
    ])
    expect([...found.unreached]).toEqual([2])
    expect([...found.sessions.keys()]).toEqual(['b/two.ts'])
    expect(found.churn).toBeNull()
    expect(found.recorded).toBe(1)
  })
})

describe('palette', () => {
  it('reads hex colours and clamps the fill', () => {
    expect(rgbOf('#2f6bd8')).toEqual([47, 107, 216])
    expect(rgbOf(' #abc ')).toEqual([170, 187, 204])
    expect(rgbOf('rgb(1, 2, 3)')).toBeNull()
    expect(fillOf('#010203', null)).toBeNull()
    expect(fillOf('#010203', Number.NaN)).toBeNull()
    expect(fillOf('#010203', 5)).toBe('rgba(1, 2, 3, 0.900)')
    expect(fillOf('#010203', -1)).toBe('rgba(1, 2, 3, 0.100)')
    expect(fillOf('', 0)).toBe('rgba(128, 128, 128, 0.100)')
  })
})
