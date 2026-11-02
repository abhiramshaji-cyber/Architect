import { useEffect, useRef, useState } from 'react'
import type { CodeMap, FunctionsReport } from '../../../shared/types'

export type Functions = {
  report: FunctionsReport | null
  error: string | null
}

export function useFunctions(root: string | null, codeMap: CodeMap | null | undefined): Functions {
  const [found, setFound] = useState<Functions>({ report: null, error: null })
  const heard = useRef(0)

  useEffect(() => {
    setFound({ report: null, error: null })
    if (!root) return
    return window.architect.onFunctions((report) => {
      if (report.root !== root) return
      heard.current += 1
      setFound({ report, error: null })
    })
  }, [root])

  useEffect(() => {
    if (!root || codeMap === undefined) return
    let live = true
    const since = heard.current
    window.architect.rankFunctions(root).then(
      (report) => {
        if (live && heard.current === since) setFound({ report, error: null })
      },
      (err: unknown) => {
        if (live)
          setFound((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : String(err),
          }))
      },
    )
    return () => {
      live = false
    }
  }, [root, codeMap])

  return found
}
