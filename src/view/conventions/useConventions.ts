import { useCallback, useEffect, useRef, useState } from 'react'
import type { Convention, Conventions } from '../../../shared/types'
import { draftMessage } from '../../model/picker'

type Ai = { busy: boolean; found: Convention[] | null; error: string | null }

const idle: Ai = { busy: false, found: null, error: null }

const text = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function useConventions(root: string | null, architecture: unknown) {
  const [state, setState] = useState<Conventions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ai, setAi] = useState<Ai>(idle)
  const asked = useRef(root)

  useEffect(() => {
    asked.current = root
    setAi(idle)
  }, [root])

  useEffect(() => {
    if (!root) return
    let live = true
    window.architect.conventions(root).then(
      (next) => live && (setState(next), setError(null)),
      (err: unknown) => live && setError(text(err)),
    )
    return () => {
      live = false
    }
  }, [root, architecture])

  const toggle = useCallback(() => {
    if (!root || !state) return
    asked.current = state.enabled ? null : root
    setAi(idle)
    window.architect.setConventions(root, !state.enabled).then(setState, (err: unknown) => setError(text(err)))
  }, [root, state])

  const suggest = useCallback(() => {
    if (!root) return
    setAi({ busy: true, found: null, error: null })
    const settle = (next: Ai) => asked.current === root && setAi(next)
    window.architect.suggestConventions(root).then(
      (result) => settle(result.ok ? { busy: false, found: result.value, error: null } : { busy: false, found: null, error: draftMessage(result.error) }),
      (err: unknown) => settle({ busy: false, found: null, error: text(err) }),
    )
  }, [root])

  const promote = useCallback(
    async (rule: string): Promise<boolean> => {
      if (!root) return false
      try {
        await window.architect.promoteConvention(root, rule)
        setError(null)
        return true
      } catch (err) {
        setError(text(err))
        return false
      }
    },
    [root],
  )

  return { state, error, ai, toggle, suggest, promote }
}
