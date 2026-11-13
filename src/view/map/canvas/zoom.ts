export type View = { k: number; x: number; y: number }
export type Wheel = { deltaY: number; deltaMode: number; ctrlKey: boolean }

export const FIT: View = { k: 1, x: 0, y: 0 }
export const MAX = 50
const LINE = 16
const SPEED = 0.002
const PINCH = 0.01

export function clamp(view: View, w: number, h: number): View {
  const k = Math.min(MAX, Math.max(1, Number.isFinite(view.k) ? view.k : 1))
  const x = Math.min(0, Math.max(w * (1 - k), Number.isFinite(view.x) ? view.x : 0))
  const y = Math.min(0, Math.max(h * (1 - k), Number.isFinite(view.y) ? view.y : 0))
  return { k, x: x || 0, y: y || 0 }
}

export function zoomAt(view: View, px: number, py: number, factor: number, w: number, h: number): View {
  const k = Math.min(MAX, Math.max(1, view.k * (Number.isNaN(factor) ? 1 : factor)))
  const scale = k / view.k
  return clamp({ k, x: px - (px - view.x) * scale, y: py - (py - view.y) * scale }, w, h)
}

export function panBy(view: View, dx: number, dy: number, w: number, h: number): View {
  return clamp({ k: view.k, x: view.x + dx, y: view.y + dy }, w, h)
}

export function wheel(view: View, event: Wheel, px: number, py: number, w: number, h: number): View {
  const pixels = event.deltaY * (event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? h : 1)
  return zoomAt(view, px, py, Math.exp(-pixels * (event.ctrlKey ? PINCH : SPEED)), w, h)
}
