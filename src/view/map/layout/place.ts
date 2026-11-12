import type { MapNode } from './nest'
import { type Rect, squarify } from './squarify'

export type Tile = Rect & {
  node: MapNode
  depth: number
  parent: number
  open: boolean
}

export const HEADER = 16
export const PAD = 2
const ROOM = 6

function roomy(rect: Rect): boolean {
  return rect.w >= PAD * 2 + ROOM && rect.h >= HEADER + PAD + ROOM
}

export function place(focus: MapNode, w: number, h: number): Tile[] {
  const tiles: Tile[] = []

  const fill = (node: MapNode, box: Rect, depth: number, parent: number) => {
    const rects = squarify(
      node.children.map((child) => child.weight),
      box,
    )
    node.children.forEach((child, at) => {
      const rect = rects[at]
      if (!rect || rect.w <= 0 || rect.h <= 0) return
      const open = child.children.length > 0 && roomy(rect)
      tiles.push({ ...rect, node: child, depth, parent, open })
      if (open)
        fill(
          child,
          {
            x: rect.x + PAD,
            y: rect.y + HEADER,
            w: rect.w - PAD * 2,
            h: rect.h - HEADER - PAD,
          },
          depth + 1,
          tiles.length - 1,
        )
    })
  }

  fill(focus, { x: 0, y: 0, w, h }, 0, -1)
  return tiles
}
