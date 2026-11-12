import { describe, expect, it } from 'vitest'
import type { FunctionRow, Ownership } from '../../../../shared/types'
import { folderOf, grouper, nest, ownLines, UNOWNED } from './nest'
import { trail } from './trail'

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

const ownership: Ownership = {
  owned: [
    { path: 'electron/git/log.ts', owner: 'git' },
    { path: 'src/view/A.tsx', owner: 'canvas' },
  ],
  unowned: ['scripts/x.ts'],
  multi: [{ path: 'shared/both.ts', owners: ['graph', 'types'] }],
  dead: [],
}

describe('ownLines', () => {
  it('takes nested functions out of the lines of the one around them', () => {
    const rows = [
      row({ name: 'outer', line: 1, lines: 20 }),
      row({ name: 'inner', line: 3, lines: 5 }),
      row({ name: 'deeper', line: 4, lines: 2 }),
      row({ name: 'sibling', line: 10, lines: 4 }),
      row({ name: 'after', line: 30, lines: 3 }),
      row({ file: 'b.ts', name: 'other', line: 1, lines: 7 }),
    ]
    expect(ownLines(rows)).toEqual([11, 3, 2, 4, 3, 7])
    expect(ownLines(rows).reduce((a, b) => a + b, 0)).toBe(20 + 3 + 7)
  })

  it('gives an identical span to the later one and never goes below zero', () => {
    expect(ownLines([row({ line: 2, lines: 4 }), row({ line: 2, lines: 4 })])).toEqual([0, 4])
    expect(ownLines([row({ line: 1, lines: 0 })])).toEqual([0])
  })

  it('leaves overlapping but not nested spans whole', () => {
    expect(ownLines([row({ line: 1, lines: 5 }), row({ line: 4, lines: 5 })])).toEqual([5, 5])
  })
})

describe('grouper', () => {
  it('groups by owner, joins shared owners and falls back to unowned', () => {
    const group = grouper(ownership)
    expect(group.kind).toBe('component')
    expect(group.of('electron/git/log.ts')).toBe('git')
    expect(group.of('shared/both.ts')).toBe('graph + types')
    expect(group.of('scripts/x.ts')).toBe(UNOWNED)
    expect(group.of('never/scanned.ts')).toBe(UNOWNED)
  })

  it('groups by top level folder without a contract', () => {
    const group = grouper(null)
    expect(group.kind).toBe('top')
    expect(group.of('electron/git/log.ts')).toBe('electron')
    expect(group.of('main.ts')).toBe('.')
  })
})

describe('nest', () => {
  const rows = [
    row({ file: 'electron/git/log.ts', name: 'log', line: 1, lines: 30 }),
    row({ file: 'electron/git/log.ts', name: 'parse', line: 40, lines: 10 }),
    row({ file: 'src/view/A.tsx', name: 'A', line: 1, lines: 50 }),
    row({ file: 'src/view/A.tsx', name: 'empty', line: 1, lines: 50 }),
    row({ file: 'main.ts', name: 'boot', line: 1, lines: 5 }),
  ]

  it('nests component, folder, file and function with weights that add up', () => {
    const tree = nest(rows, ownership, 'demo')
    expect(tree.weight).toBe(30 + 10 + 50 + 5)
    expect(tree.children.map((c) => [c.label, c.weight])).toEqual([
      ['canvas', 50],
      ['git', 40],
      [UNOWNED, 5],
    ])
    const git = tree.children[1]
    expect(git?.children[0]).toMatchObject({ kind: 'folder', label: 'electron/git', weight: 40 })
    expect(git?.children[0]?.children[0]).toMatchObject({ kind: 'file', label: 'log.ts', path: 'electron/git/log.ts' })
    expect(git?.children[0]?.children[0]?.children.map((c) => [c.label, c.fn])).toEqual([
      ['log', 0],
      ['parse', 1],
    ])
  })

  it('drops functions with no lines of their own', () => {
    const tree = nest(rows, ownership, 'demo')
    const file = tree.children[0]?.children[0]?.children[0]
    expect(file?.children.map((c) => c.label)).toEqual(['empty'])
  })

  it('returns an empty root for no functions', () => {
    expect(nest([], null, 'demo')).toMatchObject({ kind: 'root', weight: 0, children: [] })
  })

  it('finds the trail to a node and nothing for an unknown id', () => {
    const tree = nest(rows, null, 'demo')
    const file = tree.children[0]?.children[0]?.children[0]
    expect(trail(tree, file?.id ?? '').map((n) => n.kind)).toEqual(['root', 'top', 'folder', 'file'])
    expect(trail(tree, 'gone')).toEqual([])
    expect(folderOf('main.ts')).toBe('.')
  })
})
