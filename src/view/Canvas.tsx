import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
import type { Architecture, Ownership } from '../../shared/types'
import { addEdge, removeComponent, removeEdge, type OpResult } from '../model/edit-ops'
import { liveClass, type Recent } from '../model/live/recent'
import Inspector from './Inspector'
import { edgeTypes } from './live/DrawnEdge'
import Follow, { motionMs } from './live/Follow'
import {
  build,
  dependency,
  positions,
  HANDLE_IN,
  HANDLE_OUT,
  FIT_PADDING,
  MIN_ZOOM,
  NODE_H,
  NODE_W,
  type NodeData
} from '../model/layout'

type CanvasProps = {
  architecture: Architecture
  ownership: Ownership | null
  recent: Recent
  theme: string
  selectedId: string | null
  onSelect: (id: string | null) => void
  onEdit?: (op: (a: Architecture) => OpResult) => boolean
}

const FIT = { padding: FIT_PADDING }

function Reveal({ count, stage }: { count: number; stage: number }) {
  const flow = useReactFlow()
  const width = useStore((s) => s.width)
  const seen = useRef({ count, width, stage })

  useEffect(() => {
    const grew = count > seen.current.count
    const relaid = width !== seen.current.width || stage !== seen.current.stage
    seen.current = { count, width, stage }
    if (grew || relaid) void flow.fitView({ ...FIT, duration: grew ? motionMs(220) : 0 })
  }, [count, width, stage, flow])

  return null
}

function palette() {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string) => style.getPropertyValue(name).trim()
  return {
    ink: read('--ink'),
    dots: read('--dots')
  }
}

function marker(color: string) {
  return { type: MarkerType.ArrowClosed, width: 15, height: 15, color }
}

function ComponentNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div className={`node node-${data.role}`}>
      <Handle type="target" position={Position.Top} id={HANDLE_IN} />
      <Handle type="source" position={Position.Bottom} id={HANDLE_OUT} />
      <div className="node-head">
        <span className="node-id">{data.label}</span>
        <span className="node-role">{data.files === undefined ? data.role : `${data.files} files`}</span>
      </div>
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
        <p className="owns-clean">All files owned</p>
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
              <h4>Multi-owned</h4>
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
              <h4>Unowned</h4>
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

export default function Canvas({ architecture, ownership, recent, theme, selectedId, onSelect, onEdit }: CanvasProps) {
  const editing = onEdit !== undefined

  const colors = useMemo(() => palette(), [theme])
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState(0)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const watch = new ResizeObserver((entries) => setStage(entries[entries.length - 1]?.contentRect.width ?? 0))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  const { nodes, edges } = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of ownership?.owned ?? []) counts.set(o.owner, (counts.get(o.owner) ?? 0) + 1)
    for (const m of ownership?.multi ?? []) for (const id of m.owners) counts.set(id, (counts.get(id) ?? 0) + 1)

    const { nodes: logical, links } = build(architecture)
    const at = positions(logical, links, architecture.layout, stage)

    const rfNodes: Node<NodeData>[] = logical.map((n) => ({
      id: n.id,
      type: 'component',
      draggable: false,
      deletable: editing ? true : undefined,
      position: at.get(n.id) ?? { x: 0, y: 0 },
      style: { width: NODE_W, height: NODE_H },
      data: counts.has(n.id) ? { ...n.data, files: counts.get(n.id) } : n.data
    }))

    const rfEdges: RFEdge[] = links.map((l) => ({
      id: l.id,
      type: 'drawn',
      source: l.from,
      target: l.to,
      deletable: editing ? true : undefined,
      markerEnd: marker(colors.ink),
      style: { stroke: colors.ink, strokeWidth: 1.4 }
    }))

    return { nodes: rfNodes, edges: rfEdges }
  }, [architecture, ownership, colors, editing, stage])

  const marked = useMemo(
    () => nodes.map((n) => ({ ...n, selected: n.id === selectedId, className: liveClass(recent, n.id) })),
    [nodes, selectedId, recent]
  )

  const drawn = useMemo(() => edges.map((e) => ({ ...e, className: liveClass(recent, e.id) })), [edges, recent])

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
      if (!confirm(`Delete ${what} and every edge touching ${its} from this edit?`)) return

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
      if (removed.length === 0) return
      onEdit((a) =>
        removed.reduce<OpResult>(
          (acc, e) => (acc.ok ? removeEdge(acc.architecture, e.source, e.target) : acc),
          { ok: true, architecture: a }
        )
      )
    },
    [onEdit]
  )

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onSelect(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, onSelect])

  return (
    <div ref={stageRef} className={editing ? 'canvas-stage canvas-editing' : 'canvas-stage'}>
      <ReactFlow
        nodes={marked}
        edges={drawn}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
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
        minZoom={MIN_ZOOM}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onPaneClick={close}
      >
        <Reveal count={nodes.length} stage={stage} />
        <Follow ids={selectedId ? [selectedId] : []} />
        <Background gap={26} size={1} color={colors.dots} />
        <Controls showInteractive={false} />
      </ReactFlow>
      {ownership && <OwnershipPanel ownership={ownership} />}
      {selected && <Inspector node={selected} onClose={close} onSelect={onSelect} onEdit={onEdit} onDrop={(id) => drop([id])} />}
    </div>
  )
}
