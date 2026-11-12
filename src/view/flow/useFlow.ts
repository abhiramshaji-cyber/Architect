import { useEffect, useState } from 'react'
import type { Architecture, CodeMap, Flow, FlowAsk } from '../../../shared/types'

export type Found = { flow: Flow | null; error: string | null }

const EMPTY: Found = { flow: null, error: null }

export function useFlow(
  root: string | null,
  codeMap: CodeMap | null | undefined,
  architecture: Architecture | null,
  ask: FlowAsk | null,
): Found {
  const [found, setFound] = useState<Found>(EMPTY)
  const key = ask ? JSON.stringify(ask) : ''

  useEffect(() => {
    setFound(EMPTY)
  }, [root, key])

  useEffect(() => {
    if (!root || !ask || codeMap === undefined) return
    let live = true
    window.architect.flow(root, ask).then(
      (flow) => {
        if (live) setFound({ flow, error: null })
      },
      (err: unknown) => {
        if (live) setFound({ flow: null, error: err instanceof Error ? err.message : String(err) })
      },
    )
    return () => {
      live = false
    }
  }, [root, codeMap, architecture, key])

  return found
}
