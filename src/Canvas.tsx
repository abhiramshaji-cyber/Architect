import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  applyNodeChanges,
  Handle,
  Position,
  type Node,
  type Edge as RFEdge,
  type NodeChange,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Architecture, Edge, Pending, Proposal } from '../shared/types'

type NodeData = {
  label: string
  purpose: string
  owns: string[]
  ghost: boolean
  badges: string[]
  unassigned?: boolean
}

type CanvasProps = {
  architecture: Architecture
  pending: Pending[]
  onMove: (id: string, x: number, y: number) => void
}

function edgeId(e: Edge): string {
  return `${e.from}->${e.to}`
}

const NODE_W = 220
const NODE_H = 96
const INK = '#7d8794'
const DANGER = '#e5484d'
const PROPOSE = '#6ee7b7'

type Pt = { x: number; y: number }

function sides(a: Pt, b: Pt) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? { s: 'r', t: 'l' } : { s: 'l', t: 'r' }
  return dy > 0 ? { s: 'b', t: 't' } : { s: 't', t: 'b' }
}

function centers(architecture: Architecture): Map<string, Pt> {
  return new Map(
    architecture.components.map((c) => [c.id, { x: c.position.x + NODE_W / 2, y: c.position.y + NODE_H / 2 }])
  )
}

function marker(color: string) {
  return { type: MarkerType.ArrowClosed, width: 16, height: 16, color }
}

function place(desired: Pt, taken: Pt[]): Pt {
  const collides = (p: Pt) =>
    taken.some((t) => Math.abs(t.x - p.x) < NODE_W + 28 && Math.abs(t.y - p.y) < NODE_H + 28)
  let p = desired
  for (let i = 0; i < 16 && collides(p); i++) p = { x: p.x, y: p.y + NODE_H + 44 }
  taken.push(p)
  return p
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

function packageBadges(componentId: string, pending: Pending[]): string[] {
  return pending
    .filter((p) => p.proposal.kind === 'package' && p.proposal.component === componentId)
    .map((p) => (p.proposal as Extract<Proposal, { kind: 'package' }>).name)
}

function buildNodes(architecture: Architecture, pending: Pending[]): Node<NodeData>[] {
  const realNodes: Node<NodeData>[] = architecture.components.map((c) => ({
    id: c.id,
    type: 'component',
    position: c.position,
    data: {
      label: c.id,
      purpose: c.purpose,
      owns: c.owns,
      ghost: false,
      badges: packageBadges(c.id, pending)
    }
  }))

  const maxX = architecture.components.reduce((m, c) => Math.max(m, c.position.x), 0)
  const taken: Pt[] = architecture.components.map((c) => c.position)

  const ghostComponents = pending.filter((p) => p.proposal.kind === 'component')
  ghostComponents.forEach((p, i) => {
    const proposal = p.proposal as Extract<Proposal, { kind: 'component' }>
    realNodes.push({
      id: `ghost-component-${p.id}`,
      type: 'component',
      draggable: false,
      position: place({ x: maxX + 300, y: 80 + i * 160 }, taken),
      data: { label: proposal.id, purpose: proposal.purpose, owns: proposal.owns, ghost: true, badges: [] }
    })
  })

  const minX = architecture.components.reduce((m, c) => Math.min(m, c.position.x), 0)
  const minY = architecture.components.reduce((m, c) => Math.min(m, c.position.y), 0)

  let unassignedIndex = 0
  const fileProposals = pending.filter((p) => p.proposal.kind === 'file')
  fileProposals.forEach((p) => {
    const proposal = p.proposal as Extract<Proposal, { kind: 'file' }>
    const owner = architecture.components.find((c) => c.id === proposal.component)
    const position = place(
      owner
        ? { x: owner.position.x, y: owner.position.y + NODE_H + 90 }
        : { x: minX - 320, y: minY + unassignedIndex++ * 130 },
      taken
    )
    realNodes.push({
      id: `ghost-file-${p.id}`,
      type: 'component',
      draggable: false,
      position,
      data: {
        label: proposal.path.split('/').pop() ?? proposal.path,
        purpose: proposal.path,
        owns: [],
        ghost: true,
        badges: [],
        unassigned: !owner
      }
    })
  })

  return realNodes
}

function buildEdges(architecture: Architecture, pending: Pending[]): RFEdge[] {
  const nodeIds = new Set(architecture.components.map((c) => c.id))
  const at = centers(architecture)
  const redEdgeIds = new Set<string>()
  const ghostEdges: RFEdge[] = []

  const attach = (from: string, to: string) => {
    const a = at.get(from)
    const b = at.get(to)
    if (!a || !b) return {}
    const { s, t } = sides(a, b)
    return { sourceHandle: `s-${s}`, targetHandle: `t-${t}` }
  }

  const edgeProposals = pending.filter((p) => p.proposal.kind === 'edge')
  for (const p of edgeProposals) {
    const proposal = p.proposal as Extract<Proposal, { kind: 'edge' }>
    if (!nodeIds.has(proposal.from) || !nodeIds.has(proposal.to)) continue

    const cyclePath = findCycleEdges(architecture.edges, proposal.from, proposal.to)
    const cyclical = cyclePath !== null
    if (cyclePath) cyclePath.forEach((e) => redEdgeIds.add(edgeId(e)))
    const color = cyclical ? DANGER : PROPOSE

    ghostEdges.push({
      id: `ghost-edge-${p.id}`,
      source: proposal.from,
      target: proposal.to,
      ...attach(proposal.from, proposal.to),
      label: cyclical ? 'cycle' : 'proposed',
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 4,
      labelBgStyle: { fill: '#11141a', stroke: color },
      labelStyle: { fill: color, fontSize: 10, fontWeight: 600 },
      markerEnd: marker(color),
      style: { strokeDasharray: '6 5', stroke: color, strokeWidth: 2 }
    })
  }

  const realEdges: RFEdge[] = architecture.edges.map((e) => {
    const red = redEdgeIds.has(edgeId(e))
    const color = red ? DANGER : INK
    return {
      id: edgeId(e),
      source: e.from,
      target: e.to,
      ...attach(e.from, e.to),
      markerEnd: marker(color),
      style: { stroke: color, strokeWidth: red ? 2 : 1.4 }
    }
  })

  const ownershipEdges: RFEdge[] = pending
    .filter((p) => p.proposal.kind === 'file' && nodeIds.has((p.proposal as Extract<Proposal, { kind: 'file' }>).component))
    .map((p) => ({
      id: `ghost-owns-${p.id}`,
      source: (p.proposal as Extract<Proposal, { kind: 'file' }>).component,
      target: `ghost-file-${p.id}`,
      sourceHandle: 's-b',
      targetHandle: 't-t',
      markerEnd: marker(PROPOSE),
      style: { strokeDasharray: '3 5', stroke: PROPOSE, strokeWidth: 1.4, opacity: 0.8 }
    }))

  return [...realEdges, ...ghostEdges, ...ownershipEdges]
}

const HANDLES = [
  ['t', Position.Top],
  ['r', Position.Right],
  ['b', Position.Bottom],
  ['l', Position.Left]
] as const

function ComponentNode({ data }: NodeProps<Node<NodeData>>) {
  const classes = ['node']
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
      <div className="node-id">{data.label}</div>
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

export default function Canvas({ architecture, pending, onMove }: CanvasProps) {
  const initialNodes = useMemo(() => buildNodes(architecture, pending), [architecture, pending])
  const initialEdges = useMemo(() => buildEdges(architecture, pending), [architecture, pending])

  const [nodes, setNodes] = useState(initialNodes)
  const [edges, setEdges] = useState(initialEdges)

  useEffect(() => setNodes(initialNodes), [initialNodes])
  useEffect(() => setEdges(initialEdges), [initialEdges])

  const onNodesChange = useCallback((changes: NodeChange<Node<NodeData>>[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds))
  }, [])

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node<NodeData>) => {
      if (node.data.ghost) return
      onMove(node.id, node.position.x, node.position.y)
    },
    [onMove]
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={onNodeDragStop}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={26} size={1} color="#1e232c" />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
