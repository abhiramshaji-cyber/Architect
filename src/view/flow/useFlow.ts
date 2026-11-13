import { useEffect, useState } from 'react'
import { errorText } from '../../../shared/text/error'
import type { Architecture, Flow, FlowAsk, FunctionList } from '../../../shared/types'

export type Found = { flow: Flow | null; error: string | null }

const EMPTY: Found = { flow: null, error: null }

export function useFlow(
  root: string | null,
  list: FunctionList | null,
  architecture: Architecture | null,
  ask: FlowAsk | null,
): Found {
  const [found, setFound] = useState<Found>(EMPTY)
  const key = ask ? JSON.stringify(ask) : ''

  useEffect(() => {
    setFound(EMPTY)
  }, [root, key])

  useEffect(() => {
    if (!root || !ask || !list) return
    let live = true
    window.architect.flow(root, ask).then(
      (flow) => {
        if (live) setFound({ flow, error: null })
      },
      (err: unknown) => {
        if (live) setFound({ flow: null, error: errorText(err) })
      },
    )
    return () => {
      live = false
    }
  }, [root, list, architecture, key])

  return found
}
