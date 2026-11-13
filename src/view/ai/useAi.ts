import { useEffect, useSyncExternalStore } from 'react'
import type { AiChoice, AiState } from '../../../shared/settings'
import { errorText } from '../../../shared/text/error'

type Snapshot = { state: AiState | null; busy: boolean; error: string | null }

let snapshot: Snapshot = { state: null, busy: false, error: null }
const listeners = new Set<() => void>()
let latest = 0

function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next }
  for (const listener of listeners) listener()
}

function settle(request: Promise<AiState>) {
  const mine = ++latest
  publish({ busy: true })
  request.then(
    (state) => mine === latest && publish({ state, busy: false, error: null }),
    (err: unknown) => mine === latest && publish({ busy: false, error: errorText(err) }),
  )
}

export const refreshAi = () => settle(window.architect.aiState())

export const chooseAi = (choice: AiChoice) => settle(window.architect.chooseAi(choice))

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAi(): Snapshot {
  useEffect(() => {
    if (!snapshot.state && !snapshot.busy) refreshAi()
  }, [])
  return useSyncExternalStore(subscribe, () => snapshot)
}
