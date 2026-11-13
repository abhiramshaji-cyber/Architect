import { describe, expect, it } from 'vitest'
import { clamp, FIT, MAX, panBy, wheel, zoomAt } from './zoom'

const W = 800
const H = 600

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed', () => {
    const view = zoomAt(FIT, 200, 150, 2, W, H)
    expect(view.k).toBe(2)
    expect((200 - view.x) / view.k).toBeCloseTo(200)
    expect((150 - view.y) / view.k).toBeCloseTo(150)
    const again = zoomAt(view, 600, 100, 1.5, W, H)
    expect((600 - again.x) / again.k).toBeCloseTo((600 - view.x) / view.k)
    expect((100 - again.y) / again.k).toBeCloseTo((100 - view.y) / view.k)
  })

  it('never zooms out past fit or in past the max', () => {
    expect(zoomAt(FIT, 100, 100, 0.5, W, H)).toEqual(FIT)
    expect(zoomAt({ k: 3, x: -400, y: -300 }, 0, 0, 1e-9, W, H)).toEqual(FIT)
    expect(zoomAt(FIT, 100, 100, 1e9, W, H).k).toBe(MAX)
  })

  it('ignores a factor that is not a number', () => {
    expect(zoomAt({ k: 2, x: -100, y: -50 }, 10, 10, Number.NaN, W, H)).toEqual({ k: 2, x: -100, y: -50 })
  })

  it('pulls the map back into frame when zooming out near an edge', () => {
    const view = zoomAt({ k: 4, x: -2400, y: -1800 }, W, H, 0.5, W, H)
    expect(view.k).toBe(2)
    expect(view.x).toBeGreaterThanOrEqual(W * (1 - view.k))
    expect(view.y).toBeGreaterThanOrEqual(H * (1 - view.k))
  })
})

describe('panBy', () => {
  it('moves the map by the drag distance', () => {
    expect(panBy({ k: 2, x: -400, y: -300 }, 50, -20, W, H)).toEqual({ k: 2, x: -350, y: -320 })
  })

  it('stops at every edge', () => {
    expect(panBy({ k: 2, x: -10, y: -10 }, 500, 500, W, H)).toEqual({ k: 2, x: 0, y: 0 })
    expect(panBy({ k: 2, x: -10, y: -10 }, -5000, -5000, W, H)).toEqual({ k: 2, x: -W, y: -H })
  })

  it('does not move a map at fit', () => {
    expect(panBy(FIT, 40, 40, W, H)).toEqual(FIT)
  })
})

describe('clamp', () => {
  it('falls back to fit for values that are not finite', () => {
    expect(clamp({ k: Number.NaN, x: Number.NaN, y: Number.POSITIVE_INFINITY }, W, H)).toEqual(FIT)
  })
})

describe('wheel', () => {
  const at = (deltaY: number, deltaMode = 0, ctrlKey = false) =>
    wheel(FIT, { deltaY, deltaMode, ctrlKey }, 400, 300, W, H)

  it('zooms in on scroll up and stays at fit on scroll down', () => {
    expect(at(-100).k).toBeGreaterThan(1)
    expect(at(100)).toEqual(FIT)
  })

  it('scales with the delta', () => {
    expect(at(-200).k).toBeCloseTo(at(-100).k ** 2)
  })

  it('reads line and page deltas as pixels', () => {
    expect(at(-3, 1).k).toBeCloseTo(at(-48).k)
    expect(at(-1, 2).k).toBeCloseTo(at(-H).k)
  })

  it('zooms faster for a pinch, which arrives with ctrl held', () => {
    expect(at(-10, 0, true).k).toBeGreaterThan(at(-10).k)
  })
})
