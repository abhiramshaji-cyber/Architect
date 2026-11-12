import { describe, expect, it } from 'vitest'
import type { FunctionRow, FunctionTree } from '../../../../shared/types'
import { layoutOf } from './layout'
import { WIDE } from './buckets'
import { PROJECT, UNREACHED, forcedOf, hitsOf, isOpen, lineageOf, outlineOf, shownOf, toggledOf, type Outline } from './outline'

const row = (name: string, doc?: string): FunctionRow => ({
  file: 'src/a.ts',
  name,
  line: 1,
  lines: 1,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: null,
  importance: 1,
  ...(doc === undefined ? {} : { doc }),
})

const rows = [row('main'), row('load'), row('parse', 'Reads the config.'), row('dead'), row('deadKid'), row('page')]

const tree: FunctionTree = {
  starts: [0, 5],
  groups: [],
  unreached: [3],
  children: [[1], [2], [], [4], [], []],
  also: [0, 0, 0, 0, 0, 0],
}

const shown = (outline: Outline, overrides = new Map<string, boolean>(), forced = new Set<string>()) =>
  shownOf(outline, (id) => isOpen(outline, id, overrides, forced))

describe('outline', () => {
  const outline = outlineOf({ tree, rows, calls: [], owners: {} })

  it('shows the project, its starting points and their children at first, with unreached code folded', () => {
    expect(shown(outline).ids).toEqual([PROJECT, 'f0', 'f1', 'f5', UNREACHED])
    expect(shown(outline).links).toEqual([
      { from: PROJECT, to: 'f0' },
      { from: PROJECT, to: 'f5' },
      { from: PROJECT, to: UNREACHED },
      { from: 'f0', to: 'f1' },
    ])
  })

  it('expands one node, and collapsing an ancestor hides every descendant', () => {
    expect(shown(outline, new Map([['f1', true]])).ids).toEqual([PROJECT, 'f0', 'f1', 'f2', 'f5', UNREACHED])
    expect(
      shown(
        outline,
        new Map([
          ['f1', true],
          ['f0', false],
        ]),
      ).ids,
    ).toEqual([PROJECT, 'f0', 'f5', UNREACHED])
    expect(shown(outline, new Map([[PROJECT, false]])).ids).toEqual([PROJECT])
    expect(shown(outline, new Map([[UNREACHED, true]])).ids).toContain('f3')
  })

  it('opens the ancestors of every search hit and nothing else', () => {
    const hits = hitsOf(rows, '  CONFIG ')
    expect(hits).toEqual(new Set(['f2']))
    const forced = forcedOf(outline, hits)
    expect(forced).toEqual(new Set(['f1', 'f0', PROJECT]))
    expect(shown(outline, new Map(), forced).ids).toContain('f2')

    const deep = forcedOf(outline, hitsOf(rows, 'deadkid'))
    expect(deep).toEqual(new Set([UNREACHED, 'f3', PROJECT]))
    expect(shown(outline, new Map(), deep).ids).toContain('f4')
    expect(hitsOf(rows, '   ')).toBeNull()
    expect(forcedOf(outline, null).size).toBe(0)
  })

  it('traces the path from the project card to a node', () => {
    expect(lineageOf(outline, 'f2')).toEqual(new Set(['f2', 'f1', 'f0', PROJECT]))
    expect(lineageOf(outline, 'f4')).toEqual(new Set(['f4', 'f3', UNREACHED, PROJECT]))
    expect(lineageOf(outline, null).size).toBe(0)
  })

  it('handles an empty project and lays out a top down chart', () => {
    const empty = outlineOf({
      tree: { starts: [], groups: [], unreached: [], children: [], also: [] },
      rows: [],
      calls: [],
      owners: {},
    })
    expect(shown(empty)).toEqual({ ids: [PROJECT], links: [] })

    const spots = layoutOf(shown(outline))
    const top = spots.get(PROJECT)?.y ?? 0
    expect(spots.get('f0')?.y).toBeGreaterThan(top)
    expect(spots.get('f1')?.y).toBeGreaterThan(spots.get('f0')?.y ?? 0)
  })

  it('folds starting points under a card per reason, with ungrouped starts beside them', () => {
    const grouped = outlineOf({
      tree: { ...tree, groups: [{ file: 'cli.ts', reason: 'bin', members: [0] }] },
      rows,
      calls: [],
      owners: {},
    })
    const id = 'g:bin:cli.ts'
    expect(grouped.kids.get(PROJECT)).toEqual([id, 'f5', UNREACHED])
    expect(grouped.kids.get(id)).toEqual(['f0'])
    expect(grouped.groups.get(id)?.file).toBe('cli.ts')
    expect(shown(grouped).ids).toEqual([PROJECT, id, 'f5', UNREACHED])
    expect(shown(grouped, new Map([[id, true]])).ids).toEqual([PROJECT, id, 'f0', 'f1', 'f5', UNREACHED])
    expect(lineageOf(grouped, 'f1')).toEqual(new Set(['f1', 'f0', id, PROJECT]))
    expect(forcedOf(grouped, new Set(['f2']))).toEqual(new Set(['f1', 'f0', id, PROJECT]))
  })

  it('opens the unreached bucket when the project has no starting point at all', () => {
    const lone = outlineOf({ tree: { ...tree, starts: [], groups: [] }, rows, calls: [], owners: {} })
    expect(shown(lone).ids).toEqual([PROJECT, UNREACHED, 'f3'])
    expect(shown(outline).ids).not.toContain('f3')
  })

  it('stays cheap with 1,500 functions fully expanded', () => {
    const big: FunctionTree = {
      starts: [0],
      groups: [],
      unreached: [],
      children: Array.from({ length: 1500 }, (_, at) => [2 * at + 1, 2 * at + 2].filter((to) => to < 1500)),
      also: new Array(1500).fill(0),
    }
    const outlined = outlineOf({ tree: big, rows: [], calls: [], owners: {} })
    const all = shownOf(outlined, () => true)
    expect(all.ids).toHaveLength(1501)
    expect(new Set(all.ids).size).toBe(1501)
  })

  it('buckets a wide level by component, counts what each bucket holds and opens one bucket at a time', () => {
    const wide = Array.from({ length: 30 }, (_, at) => ({
      ...row(`fn${at}`),
      file: `src/${at % 3}/x.ts`,
      entry: { reason: 'bridge' as const, file: 'preload.ts' },
    }))
    const calls = wide.map((_, at) => (at === 0 ? [1, 3] : []))
    const outlined = outlineOf({
      tree: {
        starts: wide.map((_, at) => at),
        groups: [{ file: 'preload.ts', reason: 'bridge', members: wide.map((_, at) => at) }],
        unreached: [],
        children: wide.map(() => []),
        also: wide.map(() => 0),
      },
      rows: wide,
      calls,
      owners: { 'src/0/x.ts': 'core', 'src/1/x.ts': 'ui', 'src/2/x.ts': 'ui' },
    })
    const group = 'g:bridge:preload.ts'
    const buckets = outlined.kids.get(group) ?? []
    expect(buckets.map((id) => outlined.buckets.get(id)?.label)).toEqual(['ui', 'core'])
    expect(buckets.map((id) => outlined.tallies.get(id)?.functions)).toEqual([20, 10])
    expect(buckets.map((id) => outlined.tallies.get(id)?.starts)).toEqual([20, 10])
    expect(buckets.map((id) => outlined.tallies.get(id)?.callsIn)).toEqual([1, 0])
    expect(buckets.map((id) => outlined.tallies.get(id)?.callsOut)).toEqual([0, 1])
    expect(outlined.tallies.get(group)).toEqual({ functions: 30, starts: 30, callsIn: 0, callsOut: 0 })
    expect([...outlined.kids.values()].every((list) => list.length <= WIDE)).toBe(true)
    expect(lineageOf(outlined, 'f0')).toContain(buckets[1])

    const [ui = '', core = ''] = buckets
    const none = new Set<string>()
    const first = toggledOf(outlined, new Map([[group, true]]), ui, none)
    expect(isOpen(outlined, ui, first, none)).toBe(true)
    const second = toggledOf(outlined, first, core, none)
    expect(isOpen(outlined, core, second, none)).toBe(true)
    expect(isOpen(outlined, ui, second, none)).toBe(false)
    expect(isOpen(outlined, core, toggledOf(outlined, second, core, none), none)).toBe(false)
    expect(toggledOf(outlined, new Map(), group, none).get(group)).toBe(true)
  })
})
