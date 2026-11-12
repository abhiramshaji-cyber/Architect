import { describe, expect, it } from 'vitest'
import { layoutOf } from '../functions/tree/layout'
import { CARD_H } from '../functions/tree/layout'
import { CENTER, SIDE_H, graphOf } from './graph'

const heightOf = (id: string) => (id === CENTER ? CARD_H : SIDE_H)

const side = (shown: number[], more = 0, outside = 0) => ({ shown, more, outside })

describe('graphOf', () => {
  it('puts callers before the centre and callees after, each linked through the centre', () => {
    const { items, links } = graphOf(0, { callers: side([1, 2]), callees: side([3]), mutual: new Set() })
    expect(items.map((item) => item.id)).toEqual(['in:1', 'in:2', CENTER, 'out:3'])
    expect(links).toEqual([
      { from: 'in:1', to: CENTER, kind: 'call' },
      { from: 'in:2', to: CENTER, kind: 'call' },
      { from: CENTER, to: 'out:3', kind: 'call' },
    ])
  })

  it('shows a function that calls back on both sides, marked mutual', () => {
    const { items, links } = graphOf(0, { callers: side([1]), callees: side([1]), mutual: new Set([1]) })
    expect(items.filter((item) => item.kind === 'fn' && item.mutual).map((item) => item.id)).toEqual(['in:1', 'out:1'])
    expect(links.map((link) => link.kind)).toEqual(['mutual', 'mutual'])
  })

  it('adds a more card for the hidden ones and a crossing card for calls outside the folder', () => {
    const { items, links } = graphOf(0, { callers: side([1], 40, 3), callees: side([], 0, 2), mutual: new Set() })
    expect(items.map((item) => item.id)).toEqual(['in:1', 'in:more', 'in:outside', CENTER, 'out:outside'])
    expect(items.find((item) => item.id === 'in:more')).toMatchObject({ kind: 'more', count: 40 })
    expect(links.filter((link) => link.kind === 'cross')).toEqual([
      { from: 'in:outside', to: CENTER, kind: 'cross' },
      { from: CENTER, to: 'out:outside', kind: 'cross' },
    ])
  })

  it('is just the centre for a function with no calls either way', () => {
    expect(graphOf(4, { callers: side([]), callees: side([]), mutual: new Set() })).toEqual({
      items: [{ id: CENTER, kind: 'fn', at: 4, way: null, mutual: false }],
      links: [],
    })
  })

  it('lays callers left and callees right, keeping the ranked order top to bottom', () => {
    const shown = Array.from({ length: 30 }, (_, i) => i + 1)
    const { items, links } = graphOf(0, { callers: side(shown, 5), callees: side(shown), mutual: new Set() })
    const spots = layoutOf({ ids: items.map((item) => item.id), links }, 'LR', heightOf)
    const x = (id: string) => spots.get(id)?.x ?? NaN
    const ys = (prefix: string) => shown.map((at) => spots.get(`${prefix}:${at}`)?.y ?? NaN)
    expect(x('in:1')).toBeLessThan(x(CENTER))
    expect(x('out:1')).toBeGreaterThan(x(CENTER))
    for (const prefix of ['in', 'out']) {
      const list = ys(prefix)
      expect(list).toEqual([...list].sort((a, b) => a - b))
    }
    expect(spots.get('in:more')?.y).toBeGreaterThan(spots.get('in:30')?.y ?? Infinity)
    expect((spots.get('in:2')?.y ?? 0) - (spots.get('in:1')?.y ?? 0)).toBeGreaterThanOrEqual(SIDE_H)
  })
})
