import { useEffect, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'

export default function Refit({ ready }: { ready: boolean }) {
  const { fitView } = useReactFlow()
  const done = useRef(false)

  useEffect(() => {
    if (!ready || done.current) return
    done.current = true
    void fitView({ padding: 0.14 })
  }, [ready, fitView])

  return null
}
