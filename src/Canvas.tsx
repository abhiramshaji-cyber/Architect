import { useCallback, useEffect, useMemo, useState } from 'react'

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
import type { Architecture, Pending } from '../shared/types'
import Inspector from './Inspector'
import { build, positions, sides, statusOf, NODE_W, NODE_H, type NodeData } from './layout'

type CanvasProps = {
  architecture: Architecture
  pending: Pending[]
}

const INK = '#7d8794'
const DANGER = '#e5484d'
const PROPOSE = '#6ee7b7'
function marker(color: string) {
  return { type: MarkerType.ArrowClosed, width: 15, height: 15, color }
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
        <span className="node-role">{statusOf(data)}</span>
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
  const [selectedId, setSelectedId] = useState<string | null>(null)

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

  const marked = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedId })),
    [nodes, selectedId]
  )

  const selected = nodes.find((n) => n.id === selectedId)?.data ?? null

  const close = useCallback(() => setSelectedId(null), [])

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelectedId(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  return (
    <div className="canvas-stage">
      <ReactFlow
        nodes={marked}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        fitView
        fitViewOptions={{ padding: 0.14 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_event, node) => setSelectedId(node.id)}
        onPaneClick={close}
      >
        <Background gap={26} size={1} color="#1e232c" />
        <Controls showInteractive={false} />
      </ReactFlow>
      {selected && <Inspector node={selected} onClose={close} />}
    </div>
  )
}
