import { useEffect, useState } from 'react'
import type { Recency } from '../../../shared/types'

export function useRecency(root: string | null, codeMap: unknown, architecture?: unknown): Recency | null {
  const [found, setFound] = useState<{ root: string; recency: Recency } | null>(null)

  useEffect(() => {
    if (!root) return
    let live = true
    const load = () => {
      window.architect.recency(root).then(
        (recency) => {
          if (live) setFound({ root, recency })
        },
        () => {},
      )
    }
    load()
    window.addEventListener('focus', load)
    return () => {
      live = false
      window.removeEventListener('focus', load)
    }
  }, [root, codeMap, architecture])

  return found?.root === root ? found.recency : null
}
