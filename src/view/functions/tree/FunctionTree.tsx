import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, Controls, ReactFlow, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { FunctionList, FunctionRow } from '../../../../shared/types'
import type { Way } from '../facts/calls'
import Card, { type CardNode } from './card/Card'
import { cardOf, elsewhereOf } from './card/data'
import Keep, { FIT, type Anchor } from './Keep'
import { layoutOf } from './layout'
import {
  PROJECT,
  forcedOf,
  hitsOf,
  idOf,
  isOpen,
  lineageOf,
  outlineOf,
  revealedOf,
  shownOf,
  toggledOf,
} from './outline'

type TreeProps = {
  list: FunctionList
  query: string
  project: string
  onOpen: (row: FunctionRow) => void
  onRelated: (at: number, way: Way) => void
  onFocus: (at: number) => void
}

const nodeTypes = { card: Card }

export default function FunctionTree({ list, query, project, onOpen, onRelated, onFocus }: TreeProps) {
  const { rows, tree } = list
  const outline = useMemo(() => outlineOf(list), [list])
  const [overrides, setOverrides] = useState(() => new Map<string, boolean>())
  const [focus, setFocus] = useState<string | null>(null)
  const anchor = useRef<Anchor>(null)
  const jump = useRef<string | null>(null)
  const turns = useRef(new Map<number, number>())

  useEffect(() => {
    setOverrides(new Map())
    setFocus(null)
    jump.current = null
    turns.current = new Map()
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
  const spots = useMemo(() => layoutOf(shown, 'indent'), [shown])
  const lit = useMemo(() => lineageOf(outline, focus), [outline, focus])

  const spotsLatest = useRef(spots)
  spotsLatest.current = spots
  const onToggle = useCallback(
    (id: string) => {
      const before = spotsLatest.current.get(id)
      if (before) anchor.current = { id, before }
      setFocus(id)
      setOverrides((prev) => toggledOf(outline, prev, id, forced))
    },
    [outline, forced],
  )

  const onJump = useCallback(
    (at: number) => {
      const targets = elsewhereOf(outline, list, at)
      const turn = turns.current.get(at) ?? 0
      const target = targets[turn % targets.length]
      if (target === undefined) return
      turns.current.set(at, turn + 1)
      const id = idOf(target)
      setFocus(id)
      jump.current = id
      setOverrides((prev) => revealedOf(outline, prev, id, new Set([...forced, ...lineageOf(outline, idOf(at))])))
    },
    [outline, list, forced],
  )

  const nodes = useMemo<CardNode[]>(
    () =>
      shown.ids.map((id) => {
        const card = cardOf(outline, id, list, project)
        return {
          id,
          type: 'card',
          position: spots.get(id) ?? { x: 0, y: 0 },
          data: {
            ...card,
            open: card.count > 0 && isOpen(outline, id, overrides, forced),
            dim: hits !== null && id !== PROJECT && !hits.has(id) && !forced.has(id),
            focused: id === focus,
            onToggle,
            onJump,
            onOpen,
            onRelated,
            onFocus,
          },
        }
      }),
    [shown, spots, list, outline, overrides, forced, hits, focus, project, onToggle, onJump, onOpen, onRelated, onFocus],
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
        <Keep anchor={anchor} spots={spots} hits={hits} jump={jump} />
        <Background gap={26} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
