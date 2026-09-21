import dagre from '@dagrejs/dagre'
import { isPt, type Architecture, type Edge, type Layout, type Pending, type Proposal, type Pt } from '../shared/types'

export type Role = 'entry' | 'foundation' | 'middle'

export type NodeData = {
  kind: 'component' | 'file'
  label: string
  purpose: string
  owns: string[]
  ghost: boolean
  role: Role
  badges: string[]
  files?: number
  unassigned?: boolean
}

export const NODE_W = 220
export const NODE_BASE_H = 37
export const NODE_PURPOSE_H = 30
export const NODE_BADGES_H = 24

export function heightOf(data: NodeData): number {
  const purpose = data.purpose === '' ? 0 : NODE_PURPOSE_H
  const badges = data.badges.length === 0 ? 0 : NODE_BADGES_H
  return NODE_BASE_H + purpose + badges
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

export function findCycleEdges(edges: Edge[], from: string, to: string): Edge[] | null {
  if (from === to) return []

  const queue = [to]
  const visited = new Set([to])
  const parent = new Map<string, Edge>()

  while (queue.length > 0) {
    const current = queue.shift() as string
    if (current === from) {
      const path: Edge[] = []
      let node = from
      while (node !== to) {
        const edge = parent.get(node)
        if (!edge) break
        path.push(edge)
        node = edge.from
      }
      return path
    }
    for (const e of edges) {
      if (e.from === current && !visited.has(e.to)) {
        visited.add(e.to)
        parent.set(e.to, e)
        queue.push(e.to)
      }
    }
  }
  return null
}

export function hasCycle(edges: Edge[], from: string, to: string): boolean {
  return findCycleEdges(edges, from, to) !== null
}

export function statusOf(data: NodeData): string {
  if (data.unassigned) return 'no owner'
  if (data.ghost) return 'proposed'
  return data.role
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

function packageBadges(componentId: string, pending: Pending[]): string[] {
  return pending
    .filter((p) => p.proposal.kind === 'package' && p.proposal.component === componentId)
    .map((p) => (p.proposal as Extract<Proposal, { kind: 'package' }>).name)
}

export type Logical = { id: string; data: NodeData }
export type Link = { id: string; from: string; to: string; kind: 'real' | 'proposed' | 'owns'; cyclical: boolean }

export function build(architecture: Architecture, pending: Pending[]) {
  const ids = new Set(architecture.components.map((c) => c.id))

  const nodes: Logical[] = architecture.components.map((c) => ({
    id: c.id,
    data: {
      kind: 'component',
      label: c.id,
      purpose: c.purpose,
      owns: c.owns,
      ghost: false,
      role: roleOf(c.id, architecture.edges),
      badges: packageBadges(c.id, pending)
    }
  }))

  const links: Link[] = architecture.edges.map((e) => ({
    id: `${e.from}->${e.to}`,
    from: e.from,
    to: e.to,
    kind: 'real',
    cyclical: false
  }))

  for (const p of pending) {
    if (p.proposal.kind === 'component') {
      const proposal = p.proposal
      nodes.push({
        id: `ghost-component-${p.id}`,
        data: {
          kind: 'component',
          label: proposal.id,
          purpose: proposal.purpose,
          owns: proposal.owns,
          ghost: true,
          role: 'middle',
          badges: []
        }
      })
    }

    if (p.proposal.kind === 'file') {
      const proposal = p.proposal
      const owned = ids.has(proposal.component)
      const id = `ghost-file-${p.id}`
      nodes.push({
        id,
        data: {
          kind: 'file',
          label: proposal.path.split('/').pop() ?? proposal.path,
          purpose: proposal.path,
          owns: [],
          ghost: true,
          role: 'middle',
          badges: [],
          unassigned: !owned
        }
      })
      if (owned) links.push({ id: `owns-${p.id}`, from: proposal.component, to: id, kind: 'owns', cyclical: false })
    }

    if (p.proposal.kind === 'edge') {
      const proposal = p.proposal
      if (!ids.has(proposal.from) || !ids.has(proposal.to)) continue
      const cyclePath = findCycleEdges(architecture.edges, proposal.from, proposal.to)
      if (cyclePath) {
        const inCycle = new Set(cyclePath.map((e) => `${e.from}->${e.to}`))
        for (const link of links) if (inCycle.has(link.id)) link.cyclical = true
      }
      links.push({
        id: `proposed-${p.id}`,
        from: proposal.from,
        to: proposal.to,
        kind: 'proposed',
        cyclical: cyclePath !== null
      })
    }
  }

  return { nodes, links }
}

type Box = { x: number; y: number; w: number; h: number }

const SETTLE_GAP = 24

function hits(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function positions(nodes: Logical[], links: Link[], hint?: Layout): Map<string, Pt> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', ranksep: 44, nodesep: 30, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: heightOf(n.data) })
  for (const l of links) g.setEdge(l.from, l.to)

  dagre.layout(g)

  const placed = nodes.map((n) => {
    const at = g.node(n.id)
    return { id: n.id, x: at.x - NODE_W / 2, y: at.y - heightOf(n.data) / 2 }
  })

  const minY = Math.min(...placed.map((p) => p.y))
  const auto = new Map(placed.map((p) => [p.id, { x: p.x, y: p.y - minY }]))

  // pin
  const at = new Map<string, Pt>()
  const taken: Box[] = []
  for (const n of nodes) {
    const pt = hint?.[n.id]
    if (!isPt(pt)) continue
    at.set(n.id, pt)
    taken.push({ x: pt.x, y: pt.y, w: NODE_W, h: heightOf(n.data) })
  }

  if (at.size === 0) return auto

  // settle
  for (const n of nodes) {
    if (at.has(n.id)) continue
    const from = auto.get(n.id) ?? { x: 0, y: 0 }
    const box: Box = { x: from.x, y: from.y, w: NODE_W, h: heightOf(n.data) }
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
