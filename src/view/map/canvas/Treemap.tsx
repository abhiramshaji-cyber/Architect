import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MapNode } from '../layout/nest'
import { hit } from '../layout/hit'
import { place } from '../layout/place'
import { draw, type Ink } from './draw'
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
    bg: read('--bg'),
    raise: read('--raise'),
    border: read('--border'),
    text: read('--text'),
    dim: read('--text-dim'),
    font: read('--font'),
    tint: read(token),
  }
}

export default function Treemap({ focus, values, token, theme, describe, onPick }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<{ at: number; x: number; y: number } | null>(null)
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
    setHover(null)
  }, [tiles])

  useEffect(() => {
    const el = canvas.current
    if (!el || size.w === 0 || size.h === 0) return
    const ratio = window.devicePixelRatio || 1
    el.width = size.w * ratio
    el.height = size.h * ratio
    draw(el, tiles, values, inkOf(token), size.w, size.h)
  }, [tiles, values, token, theme, size])

  const pointAt = (event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const shown = hover ? tiles[hover.at] : undefined
  const told = useMemo(() => (shown ? describe(shown.node) : null), [shown, describe])

  useLayoutEffect(() => {
    setTall(tip.current?.offsetHeight ?? 0)
  }, [told])

  return (
    <div className="map-box" ref={box}>
      <canvas
        ref={canvas}
        className="map-canvas"
        style={{ width: size.w, height: size.h }}
        onMouseMove={(event) => {
          const { x, y } = pointAt(event)
          const { at } = hit(tiles, x, y)
          setHover(at < 0 ? null : { at, x, y })
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(event) => {
          const { x, y } = pointAt(event)
          const top = tiles[hit(tiles, x, y).top]
          if (top) onPick(top.node)
        }}
      />
      {shown && <div className="map-hover" style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h }} />}
      {hover && told && (
        <div
          ref={tip}
          className="map-tip"
          role="tooltip"
          style={{
            left: Math.min(hover.x + 14, Math.max(0, size.w - 320)),
            top: hover.y + 14 + tall > size.h ? Math.max(0, Math.min(hover.y - 14, size.h) - tall) : hover.y + 14,
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
