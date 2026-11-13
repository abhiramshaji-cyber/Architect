import { fillOf } from '../modes/palette'
import { HEADER, type Tile } from '../layout/place'
import type { Rect } from '../layout/squarify'
import type { View } from './zoom'

export type Ink = { bg: string; raise: string; border: string; text: string; dim: string; font: string; tint: string }

export function toScreen(view: View, rect: Rect): Rect {
  return { x: rect.x * view.k + view.x, y: rect.y * view.k + view.y, w: rect.w * view.k, h: rect.h * view.k }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, room: number) {
  if (room < 18) return
  const width = ctx.measureText(text).width
  if (width <= room) return ctx.fillText(text, x, y)
  let keep = Math.floor((text.length * room) / width)
  while (keep > 1 && ctx.measureText(`${text.slice(0, keep)}…`).width > room) keep -= 1
  if (keep > 1) ctx.fillText(`${text.slice(0, keep)}…`, x, y)
}

export function draw(
  canvas: HTMLCanvasElement,
  tiles: Tile[],
  values: Map<string, number | null>,
  ink: Ink,
  w: number,
  h: number,
  view: View,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const ratio = window.devicePixelRatio || 1
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.fillStyle = ink.bg
  ctx.fillRect(0, 0, w, h)
  ctx.font = `11px ${ink.font}`
  ctx.textBaseline = 'middle'

  for (const tile of tiles) {
    const { x, y, w: tw, h: th } = toScreen(view, tile)
    if (x >= w || y >= h || x + tw <= 0 || y + th <= 0) continue

    ctx.fillStyle = ink.raise
    ctx.fillRect(x, y, tw, th)
    const fill = tile.open ? null : fillOf(ink.tint, values.get(tile.node.id) ?? null)
    if (fill) {
      ctx.fillStyle = fill
      ctx.fillRect(x, y, tw, th)
    }
    ctx.strokeStyle = tile.open ? ink.border : ink.bg
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, tw - 1), Math.max(0, th - 1))

    const left = Math.max(x, 0)
    const room = Math.min(x + tw, w) - left - 8
    if (tile.open) {
      ctx.fillStyle = ink.dim
      label(ctx, tile.node.label, left + 4, y + (HEADER * view.k) / 2, room)
    } else if (y + th - Math.max(y, 0) >= 14) {
      ctx.fillStyle = ink.text
      label(ctx, tile.node.label, left + 4, Math.max(y, 0) + 8, room)
    }
  }
}
