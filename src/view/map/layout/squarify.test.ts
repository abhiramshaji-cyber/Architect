import { describe, expect, it } from 'vitest'
import { type Rect, squarify } from './squarify'

const area = (rect: Rect | null) => (rect ? rect.w * rect.h : 0)
const ratio = (rect: Rect) => Math.max(rect.w / rect.h, rect.h / rect.w)
const inside = (rect: Rect, box: Rect) =>
  rect.x >= box.x - 1e-9 &&
  rect.y >= box.y - 1e-9 &&
  rect.x + rect.w <= box.x + box.w + 1e-9 &&
  rect.y + rect.h <= box.y + box.h + 1e-9
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

describe('squarify', () => {
  it('lays out the Bruls et al. example with every area in proportion', () => {
    const box = { x: 0, y: 0, w: 6, h: 4 }
    const weights = [6, 6, 4, 3, 2, 2, 1]
    const rects = squarify(weights, box)
    weights.forEach((weight, at) => expect(area(rects[at] ?? null)).toBeCloseTo(weight, 6))
    expect(rects[0]).toMatchObject({ x: 0, y: 0, w: 3, h: 2 })
    expect(rects[1]).toMatchObject({ x: 0, y: 2, w: 3, h: 2 })
  })

  it('keeps tiles inside the box, apart, and close to square', () => {
    const box = { x: 10, y: 20, w: 800, h: 500 }
    const weights = Array.from({ length: 1400 }, (_, i) => ((i * 7919) % 97) + 1)
    const rects = squarify(weights, box)
    const placed = rects.filter((rect): rect is Rect => rect !== null)
    expect(placed).toHaveLength(1400)
    const total = weights.reduce((a, b) => a + b, 0)
    weights.forEach((weight, at) => expect(area(rects[at] ?? null)).toBeCloseTo((weight / total) * box.w * box.h, 3))
    for (const rect of placed) expect(inside(rect, box)).toBe(true)
    for (let i = 0; i < 60; i++)
      for (let j = i + 1; j < 60; j++) expect(overlap(placed[i] as Rect, placed[j] as Rect)).toBeLessThan(1e-6)
    expect(Math.max(...placed.map(ratio))).toBeLessThan(6)
  })

  it('returns rects in input order whatever the weight order', () => {
    const rects = squarify([1, 5, 2], { x: 0, y: 0, w: 8, h: 1 })
    expect(area(rects[0] ?? null)).toBeCloseTo(1)
    expect(area(rects[1] ?? null)).toBeCloseTo(5)
    expect(area(rects[2] ?? null)).toBeCloseTo(2)
  })

  it('leaves zero, negative and non finite weights unplaced', () => {
    const rects = squarify([0, -3, Number.NaN, Number.POSITIVE_INFINITY, 4], { x: 0, y: 0, w: 2, h: 2 })
    expect(rects.slice(0, 4)).toEqual([null, null, null, null])
    expect(rects[4]).toEqual({ x: 0, y: 0, w: 2, h: 2 })
  })

  it('places nothing in an empty or degenerate box', () => {
    expect(squarify([], { x: 0, y: 0, w: 4, h: 4 })).toEqual([])
    expect(squarify([1, 2], { x: 0, y: 0, w: 0, h: 4 })).toEqual([null, null])
    expect(squarify([1, 2], { x: 0, y: 0, w: 4, h: Number.NaN })).toEqual([null, null])
  })

  it('fills a tall box as well as a wide one', () => {
    const rects = squarify([3, 1], { x: 0, y: 0, w: 1, h: 4 })
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 1, h: 3 })
    expect(rects[1]).toEqual({ x: 0, y: 3, w: 1, h: 1 })
  })
})
