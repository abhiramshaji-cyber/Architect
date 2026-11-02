import { useEffect, useState } from 'react'
import type { CodeMap, FunctionRow } from '../../../shared/types'

export type Functions = { rows: FunctionRow[] | null; error: string | null }

export function useFunctions(root: string | null, codeMap: CodeMap | null | undefined): Functions {
  const [found, setFound] = useState<Functions>({ rows: null, error: null })

  useEffect(() => {
    setFound({ rows: null, error: null })
  }, [root])

  useEffect(() => {
    if (!root || codeMap === undefined) return
    let live = true
    window.architect.listFunctions(root).then(
      (rows) => {
        if (live) setFound({ rows, error: null })
      },
      (err: unknown) => {
        if (live) setFound((prev) => ({ ...prev, error: err instanceof Error ? err.message : String(err) }))
      },
    )
    return () => {
      live = false
    }
  }, [root, codeMap])

  return found
}
