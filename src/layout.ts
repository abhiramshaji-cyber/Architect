import dagre from '@dagrejs/dagre'
import type { Architecture, Edge, Pending, Proposal } from '../shared/types'

export type Role = 'entry' | 'foundation' | 'middle'

export type NodeData = {
  kind: 'component' | 'file'
  label: string
  purpose: string
  owns: string[]
  ghost: boolean
  role: Role
  badges: string[]
  unassigned?: boolean
}

export const NODE_W = 220
export const NODE_H = 104

export type Pt = { x: number; y: number }

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

export function sides(a: Pt, b: Pt) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dy) >= Math.abs(dx)) return dy > 0 ? { s: 'b', t: 't' } : { s: 't', t: 'b' }
  return dx > 0 ? { s: 'r', t: 'l' } : { s: 'l', t: 'r' }
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

const TOP_ANCHOR = '__architect_top'
const BOTTOM_ANCHOR = '__architect_bottom'

export function positions(nodes: Logical[], links: Link[]): Map<string, Pt> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', ranksep: 96, nodesep: 46, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H })
  for (const l of links) g.setEdge(l.from, l.to)

  // pin-entries
  const hasIncoming = new Set(links.map((l) => l.to))
  g.setNode(TOP_ANCHOR, { width: 1, height: 1 })
  for (const n of nodes) if (!hasIncoming.has(n.id)) g.setEdge(TOP_ANCHOR, n.id, { weight: 1000, minlen: 1 })

  // pin-foundations
  const hasOutgoing = new Set(links.map((l) => l.from))
  g.setNode(BOTTOM_ANCHOR, { width: 1, height: 1 })
  for (const n of nodes) {
    if (hasIncoming.has(n.id) && !hasOutgoing.has(n.id)) g.setEdge(n.id, BOTTOM_ANCHOR, { weight: 1000, minlen: 1 })
  }

  dagre.layout(g)

  const placed = nodes.map((n) => {
    const at = g.node(n.id)
    return { id: n.id, x: at.x - NODE_W / 2, y: at.y - NODE_H / 2 }
  })

  const minY = Math.min(...placed.map((p) => p.y))

  return new Map(placed.map((p) => [p.id, { x: p.x, y: p.y - minY }]))
}

