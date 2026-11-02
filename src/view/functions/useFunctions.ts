import { useEffect, useState } from 'react'
import type { CodeMap, FunctionList } from '../../../shared/types'

export type Functions = {
  list: FunctionList | null
  error: string | null
  asked: { root: string; scope: string } | null
}

const EMPTY: Functions = { list: null, error: null, asked: null }

export function useFunctions(root: string | null, codeMap: CodeMap | null | undefined, scope: string): Functions {
  const [found, setFound] = useState<Functions>(EMPTY)

  useEffect(() => {
    setFound(EMPTY)
  }, [root])

  useEffect(() => {
    if (!root || codeMap === undefined) return
    let live = true
    window.architect.listFunctions(root, scope).then(
      (list) => {
        if (live) setFound({ list, error: null, asked: { root, scope } })
      },
      (err: unknown) => {
        if (live) setFound((prev) => ({ ...prev, error: err instanceof Error ? err.message : String(err) }))
      },
    )
    return () => {
      live = false
    }
  }, [root, codeMap, scope])

  return found
}
