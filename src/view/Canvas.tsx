import { useCallback, useEffect, useMemo, useRef } from 'react'

import {
  ReactFlow,
  Background,
  Controls,
  ConnectionMode,
  MarkerType,
  Handle,
  Position,
  useReactFlow,
  useStore,
  type Connection,
  type Node,
  type OnBeforeDelete,
  type Edge as RFEdge,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Architecture, Ownership, Pending } from '../../shared/types'
import { addEdge, removeComponent, removeEdge, type OpResult } from '../model/edit-ops'
import Inspector from './Inspector'
import {
  build,
  dependency,
  heightOf,
  positions,
  statusOf,
  HANDLE_IN,
  HANDLE_OUT,
  NODE_W,
  type NodeData
} from '../model/layout'

type CanvasProps = {
  architecture: Architecture
  ownership: Ownership | null
  pending: Pending[]
  theme: string
  selectedId: string | null
  onSelect: (id: string | null) => void
  onEdit?: (op: (a: Architecture) => OpResult) => boolean
}

const FIT = { padding: 0.14 }

function Reveal({ count }: { count: number }) {
  const flow = useReactFlow()
  const width = useStore((s) => s.width)
  const seen = useRef({ count, width })

  useEffect(() => {
    const grew = count > seen.current.count
    const resized = width !== seen.current.width
    seen.current = { count, width }
    if (grew || resized) void flow.fitView({ ...FIT, duration: grew ? 220 : 0 })
  }, [count, width, flow])

  return null
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

function ComponentNode({ data }: NodeProps<Node<NodeData>>) {
  const classes = ['node', `node-${data.role}`]
  if (data.ghost) classes.push('node-ghost')
  if (data.unassigned) classes.push('node-unassigned')

  return (
    <div className={classes.join(' ')}>
      <Handle type="target" position={Position.Top} id={HANDLE_IN} />
      <Handle type="source" position={Position.Bottom} id={HANDLE_OUT} />
      <div className="node-head">
        <span className="node-id">{data.label}</span>
        <span className="node-role">{data.files === undefined ? statusOf(data) : `${data.files} files`}</span>
      </div>
      {data.purpose && <div className="node-purpose">{data.purpose}</div>}
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

function OwnershipPanel({ ownership }: { ownership: Ownership }) {
  const total = ownership.owned.length + ownership.unowned.length + ownership.multi.length
  if (total === 0 && ownership.dead.length === 0) return null

  const flags = ownership.unowned.length + ownership.multi.length + ownership.dead.length

  return (
    <details className="owns-panel">
      <summary>
        <span className="owns-count">{ownership.owned.length} owned</span>
        <span className={ownership.unowned.length > 0 ? 'owns-count warn' : 'owns-count'}>
          {ownership.unowned.length} unowned
        </span>
        <span className={ownership.multi.length > 0 ? 'owns-count bad' : 'owns-count'}>
          {ownership.multi.length} multi-owned
        </span>
        <span className={ownership.dead.length > 0 ? 'owns-count bad' : 'owns-count'}>
          {ownership.dead.length} dead globs
        </span>
      </summary>
      {flags === 0 ? (
        <p className="owns-clean">Every scanned file is owned by exactly one component.</p>
      ) : (
        <div className="owns-lists">
          {ownership.dead.length > 0 && (
            <section>
              <h4>Dead globs</h4>
              <ul>
                {ownership.dead.map((d) => (
                  <li key={`${d.component}:${d.pattern}`}>
                    <code>{d.pattern || '(empty)'}</code> on {d.component} matches nothing
                  </li>
                ))}
              </ul>
            </section>
          )}
          {ownership.multi.length > 0 && (
            <section>
              <h4>Claimed by more than one component</h4>
              <ul>
                {ownership.multi.map((m) => (
                  <li key={m.path}>
                    <code>{m.path}</code> {m.owners.join(', ')}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {ownership.unowned.length > 0 && (
            <section>
              <h4>Owned by no component</h4>
              <ul>
                {ownership.unowned.map((u) => (
                  <li key={u}>
                    <code>{u}</code>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </details>
  )
}

const nodeTypes = { component: ComponentNode }

const DELETE_KEYS = ['Delete', 'Backspace']

export default function Canvas({ architecture, ownership, pending, theme, selectedId, onSelect, onEdit }: CanvasProps) {
  const editing = onEdit !== undefined

  const colors = useMemo(() => palette(), [theme])

  const { nodes, edges, realIds } = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of ownership?.owned ?? []) counts.set(o.owner, (counts.get(o.owner) ?? 0) + 1)
    for (const m of ownership?.multi ?? []) for (const id of m.owners) counts.set(id, (counts.get(id) ?? 0) + 1)

    const { nodes: logical, links } = build(architecture, pending)
    const at = positions(logical, links, architecture.layout)

    const rfNodes: Node<NodeData>[] = logical.map((n) => ({
      id: n.id,
      type: 'component',
      draggable: false,
      deletable: editing ? !n.data.ghost : undefined,
      position: at.get(n.id) ?? { x: 0, y: 0 },
      style: { width: NODE_W, height: heightOf(n.data) },
      data: counts.has(n.id) ? { ...n.data, files: counts.get(n.id) } : n.data
    }))

    const rfEdges: RFEdge[] = links.map((l) => {
      const color = l.cyclical ? colors.danger : l.kind === 'real' ? colors.ink : colors.propose
      const dashed = l.kind !== 'real'
      return {
        id: l.id,
        source: l.from,
        target: l.to,
        deletable: editing ? l.kind === 'real' : undefined,
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
  }, [architecture, ownership, pending, colors, editing])

  const marked = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedId })),
    [nodes, selectedId]
  )

  const selected = nodes.find((n) => n.id === selectedId)?.data ?? null

  const close = useCallback(() => onSelect(null), [onSelect])

  const connect = useCallback(
    (connection: Connection) => {
      if (!onEdit) return
      const link = dependency(connection)
      if (!link) return
      const known = new Set(architecture.components.map((c) => c.id))
      if (!known.has(link.from) || !known.has(link.to)) return
      onEdit((a) => addEdge(a, link.from, link.to))
    },
    [onEdit, architecture]
  )

  // xyflow still deletes on Backspace inside a focused field when a modifier is held
  const beforeDelete = useCallback<OnBeforeDelete<Node<NodeData>, RFEdge>>(async () => {
    const active = document.activeElement
    return !(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
  }, [])

  const drop = useCallback(
    (ids: string[]) => {
      if (!onEdit) return
      const known = new Set(architecture.components.map((c) => c.id))
      const gone = ids.filter((id) => known.has(id))
      if (gone.length === 0) return

      const what = gone.length === 1 ? `"${gone[0]}"` : `${gone.length} components`
      const its = gone.length === 1 ? 'it' : 'them'
      if (!confirm(`Delete ${what} and every edge touching ${its}? Saving the edit writes this to architect.md.`)) return

      onEdit((a) =>
        gone.reduce<OpResult>(
          (acc, id) => (acc.ok ? removeComponent(acc.architecture, id) : acc),
          { ok: true, architecture: a }
        )
      )
    },
    [onEdit, architecture]
  )

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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onSelect(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, onSelect])

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
        onNodesDelete={editing ? (removed) => drop(removed.map((n) => n.id)) : undefined}
        onEdgesDelete={editing ? disconnect : undefined}
        fitView
        fitViewOptions={FIT}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onPaneClick={close}
      >
        <Reveal count={nodes.length} />
        <Background gap={26} size={1} color={colors.dots} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {ownership && <OwnershipPanel ownership={ownership} />}
      {selected && <Inspector node={selected} onClose={close} onSelect={onSelect} onEdit={onEdit} onDrop={(id) => drop([id])} />}
    </div>
  )
}
