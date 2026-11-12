import { fillOf } from '../modes/palette'
import { HEADER, type Tile } from '../layout/place'

export type Ink = { bg: string; raise: string; border: string; text: string; dim: string; font: string; tint: string }

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
    ctx.fillStyle = ink.raise
    ctx.fillRect(tile.x, tile.y, tile.w, tile.h)
    const fill = tile.open ? null : fillOf(ink.tint, values.get(tile.node.id) ?? null)
    if (fill) {
      ctx.fillStyle = fill
      ctx.fillRect(tile.x, tile.y, tile.w, tile.h)
    }
    ctx.strokeStyle = tile.open ? ink.border : ink.bg
    ctx.lineWidth = 1
    ctx.strokeRect(tile.x + 0.5, tile.y + 0.5, Math.max(0, tile.w - 1), Math.max(0, tile.h - 1))

    if (tile.open) {
      ctx.fillStyle = ink.dim
      label(ctx, tile.node.label, tile.x + 4, tile.y + HEADER / 2, tile.w - 8)
    } else if (tile.h >= 14) {
      ctx.fillStyle = ink.text
      label(ctx, tile.node.label, tile.x + 4, tile.y + 8, tile.w - 8)
    }
  }
}
