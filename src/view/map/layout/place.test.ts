import { describe, expect, it } from 'vitest'
import type { MapNode } from './nest'
import { hit } from './hit'
import { HEADER, PAD, place } from './place'

const leaf = (id: string, weight: number): MapNode => ({
  id,
  label: id,
  kind: 'function',
  path: '',
  weight,
  children: [],
  fn: 0,
})
const group = (id: string, children: MapNode[]): MapNode => ({
  id,
  label: id,
  kind: 'file',
  path: id,
  weight: children.reduce((a, c) => a + c.weight, 0),
  children,
})

describe('place', () => {
  const root = group('root', [group('big', [leaf('a', 3), leaf('b', 1)]), group('small', [leaf('c', 1)])])

  it('opens roomy groups under a header and nests their children inside', () => {
    const tiles = place(root, 400, 200)
    const big = tiles.find((t) => t.node.id === 'big')
    const a = tiles.find((t) => t.node.id === 'a')
    expect(big?.open).toBe(true)
    expect(a?.depth).toBe(1)
    expect(a && big && a.y >= big.y + HEADER && a.x >= big.x + PAD).toBe(true)
    expect(tiles.filter((t) => t.depth === 0).map((t) => t.node.id)).toEqual(['big', 'small'])
  })

  it('keeps a group closed when it has no room for its children', () => {
    const tiles = place(root, 20, 20)
    expect(tiles.some((t) => t.open)).toBe(false)
    expect(tiles.map((t) => t.node.id)).toEqual(['big', 'small'])
  })

  it('places nothing in an empty area', () => {
    expect(place(root, 0, 0)).toEqual([])
  })

  it('hits the deepest tile and climbs back to the top one', () => {
    const tiles = place(root, 400, 200)
    const a = tiles.findIndex((t) => t.node.id === 'a')
    const tile = tiles[a]
    const found = tile ? hit(tiles, tile.x + 1, tile.y + 1) : null
    expect(found?.at).toBe(a)
    expect(tiles[found?.top ?? -1]?.node.id).toBe('big')
    expect(hit(tiles, -5, -5)).toEqual({ at: -1, top: -1 })
    expect(hit([], 1, 1)).toEqual({ at: -1, top: -1 })
  })
})
