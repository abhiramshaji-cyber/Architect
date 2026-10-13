import { useEffect } from 'react'
import { useReactFlow, useStoreApi } from '@xyflow/react'
import { FIT_PADDING } from '../../model/layout'

const PAN_MS = 600

export function motionMs(ms: number): number {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : ms
}

export default function Follow({ ids }: { ids: string[] }) {
  const flow = useReactFlow()
  const store = useStoreApi()
  const wanted = JSON.stringify(ids)

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const present = (JSON.parse(wanted) as string[]).filter((id) => flow.getNode(id))
      const { width, height } = store.getState()
      if (present.length === 0 || width === 0) return

      const box = flow.getNodesBounds(present)
      const { x, y, zoom } = flow.getViewport()
      const view = { x: -x / zoom, y: -y / zoom, width: width / zoom, height: height / zoom }
      const inside =
        box.x >= view.x &&
        box.y >= view.y &&
        box.x + box.width <= view.x + view.width &&
        box.y + box.height <= view.y + view.height
      if (inside) return

      const duration = motionMs(PAN_MS)
      const fits = box.width <= view.width && box.height <= view.height
      if (fits) void flow.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom, duration })
      else void flow.fitBounds(box, { padding: FIT_PADDING, duration })
    })
    return () => cancelAnimationFrame(frame)
  }, [wanted, flow, store])

  return null
}
