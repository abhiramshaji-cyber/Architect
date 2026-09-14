import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
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

  const ghostComponents = pending.filter((p) => p.proposal.kind === 'component')
  ghostComponents.forEach((p, i) => {
    const proposal = p.proposal as Extract<Proposal, { kind: 'component' }>
    realNodes.push({
      id: `ghost-component-${p.id}`,
      type: 'component',
      draggable: false,
      position: { x: maxX + 260, y: 80 + i * 160 },
      data: { label: proposal.id, purpose: proposal.purpose, owns: proposal.owns, ghost: true, badges: [] }
    })
  })

  let unassignedIndex = 0
  const fileProposals = pending.filter((p) => p.proposal.kind === 'file')
  fileProposals.forEach((p) => {
    const proposal = p.proposal as Extract<Proposal, { kind: 'file' }>
    const owner = architecture.components.find((c) => c.id === proposal.component)
    const position = owner
      ? { x: owner.position.x + 40, y: owner.position.y + 160 }
      : { x: 40, y: 40 + unassignedIndex++ * 90 }
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
  const redEdgeIds = new Set<string>()
  const ghostEdges: RFEdge[] = []

  const edgeProposals = pending.filter((p) => p.proposal.kind === 'edge')
  for (const p of edgeProposals) {
    const proposal = p.proposal as Extract<Proposal, { kind: 'edge' }>
    if (!nodeIds.has(proposal.from) || !nodeIds.has(proposal.to)) continue

    const cyclePath = findCycleEdges(architecture.edges, proposal.from, proposal.to)
    const cyclical = cyclePath !== null
    if (cyclePath) cyclePath.forEach((e) => redEdgeIds.add(edgeId(e)))

    ghostEdges.push({
      id: `ghost-edge-${p.id}`,
      source: proposal.from,
      target: proposal.to,
      style: { strokeDasharray: '6 4', stroke: cyclical ? '#e5484d' : '#8a8f98', strokeWidth: 1.5 }
    })
  }

  const realEdges: RFEdge[] = architecture.edges.map((e) => ({
    id: edgeId(e),
    source: e.from,
    target: e.to,
    style: redEdgeIds.has(edgeId(e)) ? { stroke: '#e5484d', strokeWidth: 2 } : undefined
  }))

  return [...realEdges, ...ghostEdges]
}

function ComponentNode({ data }: NodeProps<Node<NodeData>>) {
  const classes = ['node']
  if (data.ghost) classes.push('node-ghost')
  if (data.unassigned) classes.push('node-unassigned')

  return (
    <div className={classes.join(' ')}>
      <Handle type="target" position={Position.Left} />
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
      <Handle type="source" position={Position.Right} />
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

  const onNodesChange = useCallback((changes: NodeChange[]) => {
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
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} color="#242a35" />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
