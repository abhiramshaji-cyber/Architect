import { useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'
import { FIT_PADDING } from '../../model/layout'
import { motionMs } from '../live/Follow'

export default function FitTo({ ids, stamp }: { ids: string[]; stamp: string }) {
  const flow = useReactFlow()
  const wanted = ids.join('\n')

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const nodes = wanted === '' ? undefined : wanted.split('\n').map((id) => ({ id }))
      void flow.fitView({ nodes, padding: FIT_PADDING, duration: motionMs(400) })
    })
    return () => cancelAnimationFrame(frame)
  }, [wanted, stamp, flow])

  return null
}
