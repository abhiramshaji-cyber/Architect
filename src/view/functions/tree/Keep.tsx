import { useEffect, useRef, type MutableRefObject } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import type { Spot } from './layout'
import { PROJECT } from './outline'

export type Anchor = { id: string; before: Spot } | null

export const FIT = { padding: 0.12, maxZoom: 1 }

const START_ZOOM = 0.9

const START_TOP = 24

const START_LEFT = 24

export default function Keep({
  anchor,
  spots,
  hits,
  jump,
}: {
  anchor: MutableRefObject<Anchor>
  spots: Map<string, Spot>
  hits: Set<string> | null
  jump: MutableRefObject<string | null>
}) {
  const { getViewport, setViewport, fitView } = useReactFlow()
  const width = useStore((state) => state.width)
  const placed = useRef(false)

  useEffect(() => {
    const top = spots.get(PROJECT)
    if (placed.current || !top || width <= 0) return
    placed.current = true
    setViewport({ x: START_LEFT - top.x * START_ZOOM, y: START_TOP - top.y * START_ZOOM, zoom: START_ZOOM })
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

  useEffect(() => {
    const id = jump.current
    if (id === null || !spots.has(id)) return
    jump.current = null
    requestAnimationFrame(() => fitView({ ...FIT, nodes: [{ id }], duration: 200 }))
  }, [jump, spots, fitView])

  return null
}
