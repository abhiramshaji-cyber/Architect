import { useEffect, useState } from 'react'
import type { Churn } from '../../../shared/recency'

type Read = { root: string; days: number; churn: Churn | null; error: string | null }

export function useChurn(root: string | null, days: number, codeMap: unknown): Read | null {
  const [read, setRead] = useState<Read | null>(null)

  useEffect(() => {
    if (!root) return
    let live = true
    window.architect.churn(root, days).then(
      (churn) => live && setRead({ root, days, churn, error: null }),
      (err: unknown) => live && setRead({ root, days, churn: null, error: err instanceof Error ? err.message : String(err) }),
    )
    return () => {
      live = false
    }
  }, [root, days, codeMap])

  return read?.root === root && read.days === days ? read : null
}
