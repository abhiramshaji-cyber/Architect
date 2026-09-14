import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  ReactFlow,
  Background,
  Controls,
  ConnectionMode,
  MarkerType,
  Handle,
  Position,
  type Connection,
  type Node,
  type OnBeforeDelete,
  type Edge as RFEdge,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Architecture, Pending } from '../shared/types'
import { addEdge, removeEdge, type OpResult } from './edit-ops'
import Inspector from './Inspector'
import { build, positions, sides, statusOf, NODE_W, NODE_H, type NodeData } from './layout'

type CanvasProps = {
  architecture: Architecture
  pending: Pending[]
  theme: string
  onEdit?: (op: (a: Architecture) => OpResult) => void
}

function palette() {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string) => style.getPropertyValue(name).trim()
  return {
    ink: read('--ink'),
    danger: read('--danger'),
    propose: read('--propose'),
    labelBg: read('--label-bg'),
    dots: read('--dots')
  }
}

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
        <Handle key={`t-${key}`} id={`t-${key}`} type="target" position={position} />
      ))}
      {HANDLES.map(([key, position]) => (
        <Handle key={`s-${key}`} id={`s-${key}`} type="source" position={position} />
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

const DELETE_KEYS = ['Delete', 'Backspace']

export default function Canvas({ architecture, pending, theme, onEdit }: CanvasProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const editing = onEdit !== undefined

  const colors = useMemo(() => palette(), [theme])

  const { nodes, edges, realIds } = useMemo(() => {
    const { nodes: logical, links } = build(architecture, pending)
    const at = positions(logical, links)

    const rfNodes: Node<NodeData>[] = logical.map((n) => ({
      id: n.id,
      type: 'component',
      draggable: false,
      deletable: editing ? false : undefined,
      position: at.get(n.id) ?? { x: 0, y: 0 },
      data: n.data
    }))

    const center = (id: string) => {
      const p = at.get(id) ?? { x: 0, y: 0 }
      return { x: p.x + NODE_W / 2, y: p.y + NODE_H / 2 }
    }

    const rfEdges: RFEdge[] = links.map((l) => {
      const { s, t } = sides(center(l.from), center(l.to))
      const color = l.cyclical ? colors.danger : l.kind === 'real' ? colors.ink : colors.propose
      const dashed = l.kind !== 'real'
      return {
        id: l.id,
        source: l.from,
        target: l.to,
        deletable: editing ? l.kind === 'real' : undefined,
        sourceHandle: `s-${s}`,
        targetHandle: `t-${t}`,
        markerEnd: marker(color),
        ...(l.cyclical && l.kind === 'proposed'
          ? {
              label: 'cycle',
              labelBgPadding: [6, 3] as [number, number],
              labelBgBorderRadius: 4,
              labelBgStyle: { fill: colors.labelBg, stroke: colors.danger },
              labelStyle: { fill: colors.danger, fontSize: 10, fontWeight: 600 }
            }
          : {}),
        style: {
          stroke: color,
          strokeWidth: l.cyclical ? 2 : 1.4,
          ...(dashed ? { strokeDasharray: l.kind === 'owns' ? '3 5' : '6 5' } : {})
        }
      }
    })

    const real = new Set(links.filter((l) => l.kind === 'real').map((l) => l.id))

    return { nodes: rfNodes, edges: rfEdges, realIds: real }
  }, [architecture, pending, colors, editing])

  const marked = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedId })),
    [nodes, selectedId]
  )

  const selected = nodes.find((n) => n.id === selectedId)?.data ?? null

  const close = useCallback(() => setSelectedId(null), [])

  const connect = useCallback(
    (connection: Connection) => {
      if (!onEdit) return
      const ids = new Set(architecture.components.map((c) => c.id))
      const { source, target } = connection
      if (!ids.has(source) || !ids.has(target)) return
      onEdit((a) => addEdge(a, source, target))
    },
    [onEdit, architecture]
  )

  // xyflow still deletes on Backspace inside a focused field when a modifier is held
  const beforeDelete = useCallback<OnBeforeDelete<Node<NodeData>, RFEdge>>(async () => {
    const active = document.activeElement
    return !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
  }, [])

  const disconnect = useCallback(
    (removed: RFEdge[]) => {
      if (!onEdit) return
      const cut = removed.filter((e) => realIds.has(e.id))
      if (cut.length === 0) return
      onEdit((a) =>
        cut.reduce<OpResult>(
          (acc, e) => (acc.ok ? removeEdge(acc.architecture, e.source, e.target) : acc),
          { ok: true, architecture: a }
        )
      )
    },
    [onEdit, realIds]
  )

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelectedId(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  return (
    <div className={editing ? 'canvas-stage canvas-editing' : 'canvas-stage'}>
      <ReactFlow
        nodes={marked}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={editing}
        connectionMode={editing ? ConnectionMode.Loose : undefined}
        deleteKeyCode={editing ? DELETE_KEYS : undefined}
        onBeforeDelete={editing ? beforeDelete : undefined}
        onConnect={editing ? connect : undefined}
        onEdgesDelete={editing ? disconnect : undefined}
        fitView
        fitViewOptions={{ padding: 0.14 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_event, node) => setSelectedId(node.id)}
        onPaneClick={close}
      >
        <Background gap={26} size={1} color={colors.dots} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {selected && <Inspector key={selectedId} node={selected} onClose={close} onEdit={onEdit} />}
    </div>
  )
}
