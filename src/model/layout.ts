import dagre from '@dagrejs/dagre'
import { isPt, type Architecture, type Edge, type Layout, type Pt } from '../../shared/types'

export type Role = 'entry' | 'foundation' | 'middle'

export type NodeData = {
  label: string
  purpose: string
  owns: string[]
  role: Role
  files?: number
}

export const NODE_W = 220
export const NODE_H = 37

const RANK_SEP = 44
export const NODE_SEP = 30
const NODE_TITLE_PX = 13.5
const LEGIBLE_PX = 9
export const MIN_ZOOM = LEGIBLE_PX / NODE_TITLE_PX
export const FIT_PADDING = 0.14
export const DEFAULT_STAGE_W = 1200

export function columnsFor(stage: number): number {
  const width = Number.isFinite(stage) && stage > 0 ? stage : DEFAULT_STAGE_W
  const legible = (width * (1 - 2 * FIT_PADDING)) / MIN_ZOOM
  return Math.max(1, Math.floor((legible + NODE_SEP) / (NODE_W + NODE_SEP)))
}

export const INSPECTOR_W = 640
export const INSPECTOR_MIN_W = 300
export const INSPECTOR_MAX_W = 960
export const INSPECTOR_SHARE = 0.7

export function clampInspectorWidth(px: number, stage: number): number {
  const share = Number.isFinite(stage) ? stage * INSPECTOR_SHARE : INSPECTOR_MAX_W
  const max = Math.min(INSPECTOR_MAX_W, share)
  const min = Math.min(INSPECTOR_MIN_W, max)
  if (!Number.isFinite(px)) return Math.round(Math.min(INSPECTOR_W, max))
  return Math.round(Math.min(Math.max(px, min), max))
}

export function folderName(root: string): string {
  const segments = root.split(/[/\\]/).filter(Boolean)
  return segments[segments.length - 1] ?? root
}

export function roleOf(id: string, edges: Edge[]): Role {
  const dependsOnSomething = edges.some((e) => e.from === id)
  const somethingDependsOnIt = edges.some((e) => e.to === id)
  if (!somethingDependsOnIt) return 'entry'
  if (!dependsOnSomething) return 'foundation'
  return 'middle'
}

export type Logical = { id: string; data: NodeData }
export type Link = { id: string; from: string; to: string }

export function build(architecture: Architecture) {
  const nodes: Logical[] = architecture.components.map((c) => ({
    id: c.id,
    data: { label: c.id, purpose: c.purpose, owns: c.owns, role: roleOf(c.id, architecture.edges) }
  }))

  const links: Link[] = architecture.edges.map((e) => ({ id: `${e.from}->${e.to}`, from: e.from, to: e.to }))

  return { nodes, links }
}

type Box = { x: number; y: number; w: number; h: number }

const SETTLE_GAP = 24

function hits(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

type Sized = { id: string; cx: number; cy: number; h: number }

function grid(placed: Sized[], columns: number): Map<string, Pt> {
  const bands = new Map<number, Sized[]>()
  for (const p of placed) {
    const band = bands.get(p.cy)
    if (band) band.push(p)
    else bands.set(p.cy, [p])
  }

  const ordered = [...bands].sort((a, b) => a[0] - b[0])
  const at = new Map<string, Pt>()

  // ranked
  if (!ordered.some(([, band]) => band.length > columns)) {
    for (const p of placed) at.set(p.id, { x: p.cx - NODE_W / 2, y: p.cy - p.h / 2 })
    return at
  }

  // packed
  const centre = (Math.min(...placed.map((p) => p.cx)) + Math.max(...placed.map((p) => p.cx))) / 2
  let top = Math.min(...placed.map((p) => p.cy - p.h / 2))

  for (const [, band] of ordered) {
    band.sort((a, b) => a.cx - b.cx)
    for (let i = 0; i < band.length; i += columns) {
      const row = band.slice(i, i + columns)
      const tall = Math.max(...row.map((p) => p.h))
      const left = centre - (row.length * NODE_W + (row.length - 1) * NODE_SEP) / 2
      for (const [j, p] of row.entries()) {
        at.set(p.id, { x: left + j * (NODE_W + NODE_SEP), y: top + (tall - p.h) / 2 })
      }
      top += tall + RANK_SEP
    }
  }

  return at
}

export function positions(nodes: Logical[], links: Link[], hint?: Layout, stage?: number): Map<string, Pt> {
  if (nodes.length === 0) return new Map()

  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', ranksep: RANK_SEP, nodesep: NODE_SEP, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H })
  for (const l of links) g.setEdge(l.from, l.to)

  dagre.layout(g)

  const sized = nodes.map((n) => {
    const spot = g.node(n.id)
    return { id: n.id, cx: spot.x, cy: spot.y, h: NODE_H }
  })

  const packed = grid(sized, columnsFor(stage ?? DEFAULT_STAGE_W))
  const minY = Math.min(...[...packed.values()].map((p) => p.y))
  const auto = new Map([...packed].map(([id, p]) => [id, { x: p.x, y: p.y - minY }]))

  // pin
  const at = new Map<string, Pt>()
  const taken: Box[] = []
  for (const n of nodes) {
    const pt = hint?.[n.id]
    if (!isPt(pt)) continue
    at.set(n.id, pt)
    taken.push({ x: pt.x, y: pt.y, w: NODE_W, h: NODE_H })
  }

  if (at.size === 0) return auto

  // settle
  for (const n of nodes) {
    if (at.has(n.id)) continue
    const from = auto.get(n.id) ?? { x: 0, y: 0 }
    const box: Box = { x: from.x, y: from.y, w: NODE_W, h: NODE_H }
    for (;;) {
      const clash = taken.find((t) => hits(box, t))
      if (!clash) break
      box.y = clash.y + clash.h + SETTLE_GAP
    }
    at.set(n.id, { x: box.x, y: box.y })
    taken.push(box)
  }

  return at
}

export const HANDLE_IN = 'in'
export const HANDLE_OUT = 'out'

export function dependency(link: {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}): { from: string; to: string } | null {
  const ends = [
    { id: link.source, handle: link.sourceHandle },
    { id: link.target, handle: link.targetHandle }
  ]

  const out = ends.find((e) => e.handle === HANDLE_OUT)
  const into = ends.find((e) => e.handle === HANDLE_IN)
  if (!out || !into) return null

  return { from: out.id, to: into.id }
}
