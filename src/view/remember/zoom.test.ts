import { describe, expect, it } from 'vitest'
import type { FunctionRow } from '../../../shared/types'
import { nest } from '../map/layout/nest'
import { trail } from '../map/layout/trail'
import { zoomKey, zoomOf } from './zoom'

const row = (file: string, lines = 10): FunctionRow => ({
  file,
  name: 'x',
  line: 1,
  lines,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: null,
  untraced: null,
  importance: 1,
})

const rows = [row('packages/a/src/x.ts'), row('packages/a/src/y.ts', 30), row('packages/z.ts'), row('lib/b.ts')]

const zoomedTo = (owners: Record<string, string> | null, key: string | null) => {
  const tree = nest(rows, [], owners, 'project')
  return trail(tree, zoomOf(tree, key)).map((node) => node.path)
}

describe('a remembered map zoom', () => {
  it('finds a folder by its path, whatever the group above it is called', () => {
    expect(zoomedTo(null, 'folder\u0000packages/a/src')).toEqual(['', 'packages', 'packages/a/src'])
    expect(zoomedTo({ 'packages/a/src/x.ts': 'ui', 'packages/a/src/y.ts': 'ui' }, 'folder\u0000packages/a/src')).toEqual(['', 'ui', 'packages/a/src'])
  })

  it('tells a top folder from a folder of the same path by kind', () => {
    expect(zoomedTo(null, 'top\u0000packages')).toEqual(['', 'packages'])
    expect(zoomedTo(null, 'folder\u0000packages')).toEqual(['', 'packages', 'packages'])
  })

  it('takes the heaviest match when one folder is split across components, and any kind when the kind is gone', () => {
    const split = { 'packages/a/src/x.ts': 'small', 'packages/a/src/y.ts': 'big' }
    expect(zoomedTo(split, 'folder\u0000packages/a/src')).toEqual(['', 'big', 'packages/a/src'])
    expect(zoomedTo(null, 'component\u0000lib')).toEqual(['', 'lib'])
  })

  it('falls back to the root when nothing matches or nothing is stored', () => {
    expect(zoomedTo(null, 'folder\u0000gone')).toEqual([''])
    expect(zoomedTo(null, null)).toEqual([''])
    expect(zoomedTo(null, 'garbage')).toEqual([''])
  })

  it('keeps a key only for a node that can be zoomed into', () => {
    const tree = nest(rows, [], null, 'project')
    const fn = tree.children[0]?.children[0]?.children[0]?.children[0]
    expect([zoomKey(tree), fn && zoomKey(fn), zoomKey(tree.children[0]!)]).toEqual([null, null, 'top\u0000packages'])
  })
})
