import dagre from '@dagrejs/dagre'
import type { Architecture, Layout } from '../../../shared/types'
import { LABEL_CHAR_PX, LABEL_H, NODE_H, NODE_SEP, NODE_W, RANK_SEP, roleOf } from '../../model/layout'
import type { ViewState } from './action'

export type Tone = 'dim' | 'lit'

export type Shaped = { architecture: Architecture; sideways: boolean; tone: Record<string, Tone>; fit: string[] }

const GAP = { compact: 0.5, normal: 1, roomy: 2 }
const BANDS = ['entry', 'middle', 'foundation', 'external']
const BAND_COLUMNS = 6

export function route(architecture: Architecture, from: string, to: string): { nodes: string[]; edges: string[] } | null {
  const back = new Map([[from, from]])
  const queue = [from]
  for (let at = queue.shift(); at !== undefined && at !== to; at = queue.shift()) {
    for (const e of architecture.edges) {
      if (e.from !== at || back.has(e.to)) continue
      back.set(e.to, at)
      queue.push(e.to)
    }
  }
  if (!back.has(to)) return null

  const nodes = [to]
  for (let at = to; at !== from; nodes.unshift(at)) at = back.get(at) ?? from
  return { nodes, edges: nodes.slice(1).map((id, i) => `${nodes[i]}->${id}`) }
}

function neighbours(architecture: Architecture, seeds: string[], depth: number): Set<string> | null {
  if (seeds.length === 0) return null
  const near = new Set(seeds)
  let ring = seeds
  for (let step = 0; step < depth; step++) {
    const next = architecture.edges.flatMap((e) => (ring.includes(e.from) ? [e.to] : ring.includes(e.to) ? [e.from] : [])).filter((id) => !near.has(id))
    for (const id of next) near.add(id)
    ring = next
  }
  return near
}

function banded(architecture: Architecture, kinds: Map<string, string>, gap: number, sideways: boolean): Layout {
  const along = (sideways ? NODE_H : NODE_W) + NODE_SEP * gap
  const across = (sideways ? NODE_W : NODE_H) + NODE_SEP * gap
  const at: Layout = {}
  let offset = 0

  for (const kind of BANDS) {
    const band = architecture.components.filter((c) => kinds.get(c.id) === kind)
    if (band.length === 0) continue
    for (const [i, c] of band.entries()) {
      const u = (i % BAND_COLUMNS) * along
      const v = offset + Math.floor(i / BAND_COLUMNS) * across
      at[c.id] = sideways ? { x: v, y: u } : { x: u, y: v }
    }
    offset += Math.ceil(band.length / BAND_COLUMNS) * across + RANK_SEP * gap
  }

  return at
}

function ranked(architecture: Architecture, gap: number, sideways: boolean): Layout {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: sideways ? 'LR' : 'TB', ranksep: RANK_SEP * gap, nodesep: NODE_SEP * gap })
  g.setDefaultEdgeLabel(() => ({}))
  for (const c of architecture.components) g.setNode(c.id, { width: NODE_W, height: NODE_H })
  for (const e of architecture.edges) g.setEdge(e.from, e.to, e.label ? { width: e.label.length * LABEL_CHAR_PX, height: LABEL_H, labelpos: 'c' } : {})
  dagre.layout(g)

  return Object.fromEntries(
    architecture.components.map((c) => {
      const spot = g.node(c.id)
      return [c.id, { x: spot.x - NODE_W / 2, y: spot.y - NODE_H / 2 }]
    })
  )
}

export function shape(architecture: Architecture, view: ViewState): Shaped {
  const ids = new Set(architecture.components.map((c) => c.id))
  const kinds = new Map(architecture.components.map((c) => [c.id, c.owns.length === 0 ? 'external' : roleOf(c.id, architecture.edges)]))

  const focused = view.focus && neighbours(architecture, view.focus.components.filter((id) => ids.has(id)), view.focus.depth ?? 1)
  const path = view.path && ids.has(view.path.from) && ids.has(view.path.to) ? route(architecture, view.path.from, view.path.to) : null
  const lit = new Set([...(focused ?? []), ...(path?.nodes ?? [])])

  const hidden = new Set(
    [
      ...view.hide,
      ...(view.externals ? [] : [...ids].filter((id) => kinds.get(id) === 'external')),
      ...(focused && view.focus?.rest === 'hide' ? [...ids].filter((id) => !focused.has(id)) : [])
    ].filter((id) => !lit.has(id))
  )

  const components = architecture.components.filter((c) => !hidden.has(c.id))
  const edges = architecture.edges
    .filter((e) => !hidden.has(e.from) && !hidden.has(e.to))
    .map((e) => (view.labels ? e : { from: e.from, to: e.to }))
  const shown = { ...architecture, components, edges }

  const sideways = view.layout === 'left-right'
  const gap = GAP[view.spacing]
  const custom = sideways || view.spacing !== 'normal' || view.group

  const tone: Record<string, Tone> = {}
  if (lit.size > 0) {
    for (const c of components) tone[c.id] = lit.has(c.id) ? 'lit' : 'dim'
    for (const e of edges) {
      const id = `${e.from}->${e.to}`
      tone[id] = path?.edges.includes(id) || (focused?.has(e.from) && focused.has(e.to)) ? 'lit' : 'dim'
    }
  }

  const layout = () => (view.group ? banded(shown, kinds, gap, sideways) : ranked(shown, gap, sideways))
  return { architecture: custom ? { ...shown, layout: layout() } : shown, sideways, tone, fit: [...lit] }
}
