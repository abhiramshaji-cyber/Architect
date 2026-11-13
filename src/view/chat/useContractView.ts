import { useCallback, useState } from 'react'
import { DEFAULT_VIEW, View, type ViewState } from './action'

const PREFIX = 'contract-view:'

function stored(root: string | null): ViewState {
  if (!root) return DEFAULT_VIEW
  try {
    const raw = localStorage.getItem(PREFIX + root)
    return raw ? View.parse(JSON.parse(raw)) : DEFAULT_VIEW
  } catch {
    return DEFAULT_VIEW
  }
}

export function useContractView(root: string | null): [ViewState, (view: ViewState) => void] {
  const [held, setHeld] = useState(() => ({ root, view: stored(root) }))

  if (held.root !== root) setHeld({ root, view: stored(root) })

  const save = useCallback(
    (view: ViewState) => {
      setHeld({ root, view })
      try {
        if (root) localStorage.setItem(PREFIX + root, JSON.stringify(view))
      } catch {}
    },
    [root]
  )

  return [held.root === root ? held.view : stored(root), save]
}
