import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, Controls, Panel, ReactFlow, useReactFlow, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { FunctionList, FunctionRow } from '../../../shared/types'
import { callersOf, type Way } from '../functions/facts/calls'
import { layoutOf, type Spot } from '../functions/tree/layout'
import FocusCard, { type FocusNode } from './FocusCard'
import { CENTER, graphOf, heightOf } from './graph'
import { back, forward, go, keyOf, placeOf, resolve, type Trail } from './history'
import { FIRST, PAGE, byRank, sidesOf, type Limits } from './sides'

type FocusProps = {
  list: FunctionList
  trail: Trail | null
  onTrail: (trail: Trail) => void
  onOpen: (row: FunctionRow) => void
  onRelated: (at: number, way: Way) => void
  onScope: (scope: string) => void
}

const nodeTypes = { focus: FocusCard }

const FIT = { padding: 0.12, minZoom: 0.7, maxZoom: 1 }

const START: Limits = { callers: FIRST, callees: FIRST }

function Fit({ now, center }: { now: string; center: Spot | undefined }) {
  const { fitView, getViewport, setViewport } = useReactFlow()
  const held = useRef<{ now: string; center: Spot } | null>(null)

  useEffect(() => {
    requestAnimationFrame(() => fitView(FIT))
  }, [now, fitView])

  useEffect(() => {
    const before = held.current
    held.current = center ? { now, center } : null
    if (!before || !center || before.now !== now) return
    const { x, y, zoom } = getViewport()
    setViewport({ x: x - (center.x - before.center.x) * zoom, y: y - (center.y - before.center.y) * zoom, zoom })
  }, [now, center, getViewport, setViewport])

  return null
}

export default function FocusView({ list, trail, onTrail, onOpen, onRelated, onScope }: FocusProps) {
  const { rows } = list
  const callers = useMemo(() => callersOf(list.calls), [list.calls])
  const first = useMemo(() => {
    const top = rows[rows.map((_, at) => at).sort(byRank(rows))[0] ?? -1]
    return top ? go(null, keyOf(top)) : null
  }, [rows])
  const shown = trail ?? first
  const at = useMemo(() => (shown ? resolve(rows, shown.now) : -1), [rows, shown])
  const place = shown ? placeOf(shown.now) : ''
  const [expanded, setExpanded] = useState<{ place: string; limits: Limits } | null>(null)
  const limits = expanded?.place === place ? expanded.limits : START

  useEffect(() => {
    if (!trail) {
      if (first) onTrail(first)
      return
    }
    const row = rows[at]
    if (row && keyOf(row) !== trail.now) onTrail({ ...trail, now: keyOf(row) })
  }, [trail, first, rows, at, onTrail])

  const onGo = useCallback(
    (to: number) => {
      const row = rows[to]
      if (row) onTrail(go(shown, keyOf(row)))
    },
    [rows, shown, onTrail],
  )
  const onMore = useCallback(
    (way: Way) => setExpanded({ place, limits: { ...limits, [way]: limits[way] + PAGE } }),
    [place, limits],
  )
  const onWiden = useCallback(() => onScope(''), [onScope])

  const sides = useMemo(() => sidesOf(list, callers, at, limits), [list, callers, at, limits])
  const graph = useMemo(() => (sides ? graphOf(at, sides) : null), [at, sides])
  const spots = useMemo(() => (graph ? layoutOf({ ids: graph.items.map((item) => item.id), links: graph.links }, 'LR', heightOf) : null), [graph])

  const nodes = useMemo<FocusNode[]>(
    () =>
      (graph?.items ?? []).map((item) => ({
        id: item.id,
        type: 'focus',
        position: spots?.get(item.id) ?? { x: 0, y: 0 },
        data: { item, row: item.kind === 'fn' ? (rows[item.at] ?? null) : null, scope: list.scope, onGo, onOpen, onMore, onWiden, onRelated },
      })),
    [graph, spots, rows, list.scope, onGo, onOpen, onMore, onWiden, onRelated],
  )

  const edges = useMemo<Edge[]>(
    () =>
      (graph?.links ?? []).map(({ from, to, kind }) => ({
        id: `${from}>${to}`,
        source: from,
        target: to,
        selectable: false,
        focusable: false,
        className: `fn-tree-edge focus-edge ${kind}`,
      })),
    [graph],
  )

  if (!shown) return null

  const steps = (
    <div className="fn-sort focus-steps" role="group" aria-label="Focus history">
      <button className="mode" disabled={shown.back.length === 0} onClick={() => onTrail(back(shown))} aria-label="Back">
        ←
      </button>
      <button className="mode" disabled={shown.forward.length === 0} onClick={() => onTrail(forward(shown))} aria-label="Forward">
        →
      </button>
    </div>
  )

  if (at < 0) {
    const [file, , name] = shown.now.split('\0')
    return (
      <div className="fn-empty focus-gone">
        {steps}
        <p>
          <code>{name}</code> in {file} is not {list.scope === '' ? 'in this project' : `in ${list.scope}`}.
        </p>
        {list.scope !== '' && (
          <button className="mode" onClick={onWiden}>
            Show the whole project
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="fn-tree focus">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onlyRenderVisibleElements
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Fit now={`${place}\0${list.scope}`} center={spots?.get(CENTER)} />
        <Panel position="top-left">
          {steps}
        </Panel>
        <Background gap={26} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
