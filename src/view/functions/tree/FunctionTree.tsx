import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Background, Controls, ReactFlow, useReactFlow, useStore, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { EntryReason, FunctionList, FunctionRow } from '../../../../shared/types'
import { plural } from '../Mark'
import Card, { type CardNode } from './Card'
import { CARD_W, layoutOf, type Spot } from './layout'
import { PROJECT, UNREACHED, forcedOf, hitsOf, indexOf, isOpen, lineageOf, outlineOf, shownOf } from './outline'

type Anchor = { id: string; before: Spot } | null

type TreeProps = {
  list: FunctionList
  query: string
  project: string
  onOpen: (row: FunctionRow) => void
}

const nodeTypes = { card: Card }

const REASON: Record<EntryReason, string> = {
  mcpTool: 'MCP tool',
  ipcHandler: 'IPC handler',
  bridge: 'Preload bridge',
  cliCommand: 'CLI command',
  electronMain: 'Electron main',
  preload: 'Electron preload',
  renderer: 'Electron renderer',
  page: 'Page script',
  bin: 'package.json bin',
  main: 'package.json main',
}

const FIT = { padding: 0.12, maxZoom: 1 }

const START_ZOOM = 0.9

const START_TOP = 24

function Keep({
  anchor,
  spots,
  hits,
}: {
  anchor: MutableRefObject<Anchor>
  spots: Map<string, Spot>
  hits: Set<string> | null
}) {
  const { getViewport, setViewport, fitView } = useReactFlow()
  const width = useStore((state) => state.width)
  const placed = useRef(false)

  useEffect(() => {
    const top = spots.get(PROJECT)
    if (placed.current || !top || width <= 0) return
    placed.current = true
    setViewport({
      x: width / 2 - (top.x + CARD_W / 2) * START_ZOOM,
      y: START_TOP - top.y * START_ZOOM,
      zoom: START_ZOOM,
    })
  }, [spots, width, setViewport])

  useEffect(() => {
    const held = anchor.current
    anchor.current = null
    const after = held ? spots.get(held.id) : undefined
    if (!held || !after) return
    const { x, y, zoom } = getViewport()
    setViewport({
      x: x - (after.x - held.before.x) * zoom,
      y: y - (after.y - held.before.y) * zoom,
      zoom,
    })
  }, [anchor, spots, getViewport, setViewport])

  useEffect(() => {
    if (hits && hits.size > 0)
      requestAnimationFrame(() => fitView({ ...FIT, nodes: [...hits].map((id) => ({ id })), duration: 200 }))
  }, [hits, fitView])

  return null
}

export default function FunctionTree({ list, query, project, onOpen }: TreeProps) {
  const { rows, tree } = list
  const outline = useMemo(() => outlineOf(tree), [tree])
  const [overrides, setOverrides] = useState(() => new Map<string, boolean>())
  const [focus, setFocus] = useState<string | null>(null)
  const anchor = useRef<Anchor>(null)

  useEffect(() => {
    setOverrides(new Map())
    setFocus(null)
  }, [tree])

  const hits = useMemo(() => hitsOf(rows, query), [rows, query])
  const forced = useMemo(() => forcedOf(outline, hits), [outline, hits])

  useEffect(() => {
    setOverrides((prev) => {
      const kept = new Map([...prev].filter(([id]) => !forced.has(id)))
      return kept.size === prev.size ? prev : kept
    })
  }, [forced])

  const shown = useMemo(
    () => shownOf(outline, (id) => isOpen(outline, id, overrides, forced)),
    [outline, overrides, forced],
  )
  const spots = useMemo(() => layoutOf(shown), [shown])
  const lit = useMemo(() => lineageOf(outline, focus), [outline, focus])

  const spotsLatest = useRef(spots)
  spotsLatest.current = spots
  const onToggle = useCallback(
    (id: string) => {
      const before = spotsLatest.current.get(id)
      if (before) anchor.current = { id, before }
      setFocus(id)
      setOverrides((prev) => new Map(prev).set(id, !isOpen(outline, id, prev, forced)))
    },
    [outline, forced],
  )

  const nodes = useMemo<CardNode[]>(
    () =>
      shown.ids.map((id) => {
        const at = indexOf(id)
        const row = rows[at] ?? null
        const kids = outline.kids.get(id)?.length ?? 0
        const entry = outline.groups.get(id)
        const group = entry
          ? { title: REASON[entry.reason], note: `${entry.file} · ${plural(entry.members.length, 'function')}` }
          : id === PROJECT
            ? { title: project, note: plural(rows.length, 'function') }
            : id === UNREACHED
              ? {
                  title: 'Not reached from a starting point',
                  note: plural(tree.unreached.length, 'function'),
                }
              : { title: row?.name ?? id, note: '' }
        return {
          id,
          type: 'card',
          position: spots.get(id) ?? { x: 0, y: 0 },
          data: {
            ...group,
            row,
            count: kids,
            open: kids > 0 && isOpen(outline, id, overrides, forced),
            also: tree.also[at] ?? 0,
            dim: hits !== null && id !== PROJECT && !hits.has(id) && !forced.has(id),
            focused: id === focus,
            onToggle,
            onOpen,
          },
        }
      }),
    [shown, spots, rows, tree, outline, overrides, forced, hits, focus, project, onToggle, onOpen],
  )

  const edges = useMemo<Edge[]>(
    () =>
      shown.links.map(({ from, to }) => ({
        id: `${from}>${to}`,
        source: from,
        target: to,
        type: 'step',
        selectable: false,
        focusable: false,
        className: lit.has(to) ? 'fn-tree-edge lit' : 'fn-tree-edge',
        zIndex: lit.has(to) ? 1 : 0,
      })),
    [shown, lit],
  )

  return (
    <div className="fn-tree">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitViewOptions={FIT}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Keep anchor={anchor} spots={spots} hits={hits} />
        <Background gap={26} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
