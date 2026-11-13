import { useCallback, useEffect, useState } from 'react'
import type { JevState } from '../../../shared/jev/types'

export type JevHook = {
  state: JevState | null
  ready: boolean
  busy: boolean
  error: string | null
  act: (request: () => Promise<JevState>) => void
}

export function useJev(root: string | null): JevHook {
  const [state, setState] = useState<JevState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const act = useCallback((request: () => Promise<JevState>) => {
    setBusy(true)
    request().then(
      (next) => {
        setState((now) => ({ ...next, run: next.run ?? now?.run ?? null, usage: next.usage ?? now?.usage ?? null }))
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
      (first) => live && setState(first),
      (err: unknown) => live && setError(err instanceof Error ? err.message : String(err)),
    )
    const off = window.architect.onJev((progress) => {
      const own = progress.root === root ? { run: progress.run, usage: progress.usage } : {}
      setState((now) => (now ? { ...now, paused: progress.paused, budget: progress.budget, ...own } : now))
    })
    return () => {
      live = false
      off()
    }
  }, [root])

  return { state, ready: state !== null && state.enabled && state.key.set, busy, error, act }
}
