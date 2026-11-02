import { useEffect, useState } from 'react'
import type { CodeMap, FunctionList } from '../../../shared/types'

export type Functions = { list: FunctionList | null; error: string | null }

export function useFunctions(root: string | null, codeMap: CodeMap | null | undefined): Functions {
  const [found, setFound] = useState<Functions>({ list: null, error: null })

  useEffect(() => {
    setFound({ list: null, error: null })
  }, [root])

  useEffect(() => {
    if (!root || codeMap === undefined) return
    let live = true
    window.architect.listFunctions(root).then(
      (list) => {
        if (live) setFound({ list, error: null })
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
