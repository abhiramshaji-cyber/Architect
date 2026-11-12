import dagre from '@dagrejs/dagre'
import type { Shown } from './outline'

export const CARD_W = 248
export const CARD_H = 156

const NODE_SEP = 20
const RANK_SEP = 56

export type Spot = { x: number; y: number }

export function layoutOf({ ids, links }: Shown): Map<string, Spot> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: NODE_SEP, ranksep: RANK_SEP })
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of ids) g.setNode(id, { width: CARD_W, height: CARD_H })
  for (const { from, to } of links) g.setEdge(from, to)
  dagre.layout(g)

  const spots = new Map<string, Spot>()
  for (const id of ids) {
    const { x, y } = g.node(id)
    spots.set(id, { x: x - CARD_W / 2, y: y - CARD_H / 2 })
  }
  return spots
}
