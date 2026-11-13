import { useEffect, useState } from 'react'
import { errorText } from '../../../shared/text/error'
import type { Architecture, CodeMap, Layers } from '../../../shared/types'

export type Found = { layers: Layers | null; error: string | null }

const EMPTY: Found = { layers: null, error: null }

export function useLayers(root: string | null, codeMap: CodeMap | null | undefined, architecture: Architecture | null): Found {
  const [found, setFound] = useState<Found>(EMPTY)

  useEffect(() => {
    setFound(EMPTY)
  }, [root])

  useEffect(() => {
    if (!root || codeMap === undefined) return
    let live = true
    window.architect.layers(root).then(
      (layers) => {
        if (live) setFound({ layers, error: null })
      },
      (err: unknown) => {
        if (live) setFound((prev) => ({ ...prev, error: errorText(err) }))
      },
    )
    return () => {
      live = false
    }
  }, [root, codeMap, architecture])

  return found
}
