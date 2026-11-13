import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MapNode } from '../layout/nest'
import { hit } from '../layout/hit'
import { place } from '../layout/place'
import { draw, toScreen, type Ink } from './draw'
import { FIT, panBy, wheel, type View } from './zoom'
import type { Line } from '../facts'

type Props = {
  focus: MapNode
  values: Map<string, number | null>
  token: string
  theme: string
  describe: (node: MapNode) => { kind: string; title: string; lines: Line[] }
  onPick: (node: MapNode) => void
}

function inkOf(token: string): Ink {
  const css = getComputedStyle(document.documentElement)
  const read = (name: string) => css.getPropertyValue(name).trim()
  return {
    bg: read('--color-bg-primary'),
    raise: read('--color-bg-tertiary'),
    border: read('--color-border-default'),
    text: read('--color-text-primary'),
    dim: read('--color-text-muted'),
    font: read('--font-body'),
    tint: read(token),
  }
}

export default function Treemap({ focus, values, token, theme, describe, onPick }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
  const [view, setView] = useState<View>(FIT)
  const [panning, setPanning] = useState(false)
  const drag = useRef<{ x: number; y: number; from: View; moved: boolean } | null>(null)
  const dragged = useRef(false)
  const tip = useRef<HTMLDivElement>(null)
  const [tall, setTall] = useState(0)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const tiles = useMemo(() => place(focus, size.w, size.h), [focus, size])

  useEffect(() => {
    setPoint(null)
    setView(FIT)
  }, [tiles])

  useEffect(() => {
    const el = canvas.current
    if (!el || size.w === 0 || size.h === 0) return
    const ratio = window.devicePixelRatio || 1
    el.width = size.w * ratio
    el.height = size.h * ratio
    draw(el, tiles, values, inkOf(token), size.w, size.h, view)
  }, [tiles, values, token, theme, size, view])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = canvas.current?.getBoundingClientRect()
      if (!rect) return
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      setView((from) => wheel(from, event, x, y, rect.width, rect.height))
      setPoint({ x, y })
      el.focus({ preventScroll: true })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const pointAt = (event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const hitAt = (x: number, y: number) => hit(tiles, (x - view.x) / view.k, (y - view.y) / view.k)

  const shown = point ? tiles[hitAt(point.x, point.y).at] : undefined
  const ring = shown ? toScreen(view, shown) : undefined
  const told = useMemo(() => (shown ? describe(shown.node) : null), [shown, describe])

  useLayoutEffect(() => {
    setTall(tip.current?.offsetHeight ?? 0)
  }, [told])

  return (
    <div
      className="map-box"
      ref={box}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== '0' || event.metaKey || event.ctrlKey || event.altKey) return
        event.preventDefault()
        setView(FIT)
      }}
    >
      <canvas
        ref={canvas}
        className={panning ? 'map-canvas map-canvas--panning' : 'map-canvas'}
        style={{ width: size.w, height: size.h }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          drag.current = { x: event.clientX, y: event.clientY, from: view, moved: false }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          setPoint(pointAt(event))
          const start = drag.current
          if (!start) return
          const dx = event.clientX - start.x
          const dy = event.clientY - start.y
          if (!start.moved && Math.hypot(dx, dy) < 4) return
          start.moved = true
          setPanning(true)
          setView(panBy(start.from, dx, dy, size.w, size.h))
        }}
        onPointerUp={() => {
          dragged.current = drag.current?.moved ?? false
          drag.current = null
          setPanning(false)
        }}
        onPointerCancel={() => {
          drag.current = null
          setPanning(false)
        }}
        onPointerLeave={() => setPoint(null)}
        onClick={(event) => {
          if (dragged.current) {
            dragged.current = false
            return
          }
          const { x, y } = pointAt(event)
          const top = tiles[hitAt(x, y).top]
          if (top) onPick(top.node)
        }}
        onDoubleClick={(event) => {
          const { x, y } = pointAt(event)
          if (hitAt(x, y).top < 0) setView(FIT)
        }}
      />
      {ring && <div className="map-hover" style={{ left: ring.x, top: ring.y, width: ring.w, height: ring.h }} />}
      {point && told && (
        <div
          ref={tip}
          className="map-tip"
          role="tooltip"
          style={{
            left: Math.min(point.x + 14, Math.max(0, size.w - 320)),
            top: point.y + 14 + tall > size.h ? Math.max(0, Math.min(point.y - 14, size.h) - tall) : point.y + 14,
          }}
        >
          <p className="map-tip-kind">{told.kind}</p>
          <p className="map-tip-title">{told.title}</p>
          <dl>
            {told.lines.map(([name, value], at) => (
              <div key={at}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}
