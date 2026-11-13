import { useCallback, useEffect, useState } from 'react'
import type { JevState } from '../../../shared/jev/types'

export type JevHook = {
  state: JevState | null
  busy: boolean
  error: string | null
  act: (request: () => Promise<JevState>) => void
}

export const jevReady = (state: JevState | null) => state !== null && state.enabled && state.key.set

export function useJev(root: string | null): JevHook {
  const [state, setState] = useState<JevState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const act = useCallback((request: () => Promise<JevState>) => {
    setBusy(true)
    request().then(
      (next) => {
        setState((now) => ({ ...next, run: next.run ?? now?.run ?? null }))
        setError(null)
        setBusy(false)
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setBusy(false)
      },
    )
  }, [])

  useEffect(() => {
    let live = true
    window.architect.jevState(root ?? undefined).then(
      (first) => {
        if (!live) return
        setState(first)
        if (root && jevReady(first) && first.run === null) act(() => window.architect.indexJev(root))
      },
      (err: unknown) => live && setError(err instanceof Error ? err.message : String(err)),
    )
    const off = window.architect.onJev((progress) => {
      if (progress.root === root) setState((now) => (now ? { ...now, run: progress.run } : now))
    })
    return () => {
      live = false
      off()
    }
  }, [root, act])

  return { state, busy, error, act }
}
