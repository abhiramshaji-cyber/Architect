import { useMemo } from 'react'
import dagre from '@dagrejs/dagre'
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Handle,
  Position,
  type Node,
  type Edge as RFEdge,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Architecture, Edge, Pending, Proposal } from '../shared/types'

type Role = 'entry' | 'foundation' | 'middle'

type NodeData = {
  label: string
  purpose: string
  owns: string[]
  ghost: boolean
  role: Role
  badges: string[]
  unassigned?: boolean
}

type CanvasProps = {
  architecture: Architecture
  pending: Pending[]
}

const NODE_W = 220
const NODE_H = 104
const INK = '#7d8794'
const DANGER = '#e5484d'
const PROPOSE = '#6ee7b7'

type Pt = { x: number; y: number }

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

export function roleOf(id: string, edges: Edge[]): Role {
  const dependsOnSomething = edges.some((e) => e.from === id)
  const somethingDependsOnIt = edges.some((e) => e.to === id)
  if (!somethingDependsOnIt) return 'entry'
  if (!dependsOnSomething) return 'foundation'
  return 'middle'
}

function sides(a: Pt, b: Pt) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dy) >= Math.abs(dx)) return dy > 0 ? { s: 'b', t: 't' } : { s: 't', t: 'b' }
  return dx > 0 ? { s: 'r', t: 'l' } : { s: 'l', t: 'r' }
}

function marker(color: string) {
  return { type: MarkerType.ArrowClosed, width: 15, height: 15, color }
}

function packageBadges(componentId: string, pending: Pending[]): string[] {
  return pending
    .filter((p) => p.proposal.kind === 'package' && p.proposal.component === componentId)
    .map((p) => (p.proposal as Extract<Proposal, { kind: 'package' }>).name)
}

type Logical = { id: string; data: NodeData }
type Link = { id: string; from: string; to: string; kind: 'real' | 'proposed' | 'owns'; cyclical: boolean }

function build(architecture: Architecture, pending: Pending[]) {
  const ids = new Set(architecture.components.map((c) => c.id))

  const nodes: Logical[] = architecture.components.map((c) => ({
    id: c.id,
    data: {
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

function positions(nodes: Logical[], links: Link[]): Map<string, Pt> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', ranksep: 96, nodesep: 46, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H })
  for (const l of links) g.setEdge(l.from, l.to)

  dagre.layout(g)

  return new Map(
    nodes.map((n) => {
      const placed = g.node(n.id)
      return [n.id, { x: placed.x - NODE_W / 2, y: placed.y - NODE_H / 2 }]
    })
  )
}

const HANDLES = [
  ['t', Position.Top],
  ['r', Position.Right],
  ['b', Position.Bottom],
  ['l', Position.Left]
] as const

function ComponentNode({ data }: NodeProps<Node<NodeData>>) {
  const classes = ['node', `node-${data.role}`]
  if (data.ghost) classes.push('node-ghost')
  if (data.unassigned) classes.push('node-unassigned')

  return (
    <div className={classes.join(' ')}>
      {HANDLES.map(([key, position]) => (
        <Handle key={`s-${key}`} id={`s-${key}`} type="source" position={position} />
      ))}
      {HANDLES.map(([key, position]) => (
        <Handle key={`t-${key}`} id={`t-${key}`} type="target" position={position} />
      ))}
      <div className="node-head">
        <span className="node-id">{data.label}</span>
        <span className="node-role">{data.ghost ? (data.unassigned ? 'no owner' : 'proposed') : data.role}</span>
      </div>
      {data.purpose && <div className="node-purpose">{data.purpose}</div>}
      {data.owns.length > 0 && (
        <div className="node-owns">
          {data.owns.map((glob) => (
            <div key={glob}>{glob}</div>
          ))}
        </div>
      )}
      {data.badges.length > 0 && (
        <div className="node-badges">
          {data.badges.map((b) => (
            <span key={b} className="badge">{b}</span>
          ))}
        </div>
      )}
    </div>
  )
}

const nodeTypes = { component: ComponentNode }

export default function Canvas({ architecture, pending }: CanvasProps) {
  const { nodes, edges } = useMemo(() => {
    const { nodes: logical, links } = build(architecture, pending)
    const at = positions(logical, links)

    const rfNodes: Node<NodeData>[] = logical.map((n) => ({
      id: n.id,
      type: 'component',
      draggable: false,
      position: at.get(n.id) ?? { x: 0, y: 0 },
      data: n.data
    }))

    const center = (id: string) => {
      const p = at.get(id) ?? { x: 0, y: 0 }
      return { x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 }
    }

    const rfEdges: RFEdge[] = links.map((l) => {
      const { s, t } = sides(center(l.from), center(l.to))
      const color = l.cyclical ? DANGER : l.kind === 'real' ? INK : PROPOSE
      const dashed = l.kind !== 'real'
      return {
        id: l.id,
        source: l.from,
        target: l.to,
        sourceHandle: `s-${s}`,
        targetHandle: `t-${t}`,
        markerEnd: marker(color),
        ...(l.cyclical && l.kind === 'proposed'
          ? {
              label: 'cycle',
              labelBgPadding: [6, 3] as [number, number],
              labelBgBorderRadius: 4,
              labelBgStyle: { fill: '#11141a', stroke: DANGER },
              labelStyle: { fill: DANGER, fontSize: 10, fontWeight: 600 }
            }
          : {}),
        style: {
          stroke: color,
          strokeWidth: l.cyclical ? 2 : 1.4,
          ...(dashed ? { strokeDasharray: l.kind === 'owns' ? '3 5' : '6 5' } : {})
        }
      }
    })

    return { nodes: rfNodes, edges: rfEdges }
  }, [architecture, pending])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      fitView
      fitViewOptions={{ padding: 0.14 }}
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={26} size={1} color="#1e232c" />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
