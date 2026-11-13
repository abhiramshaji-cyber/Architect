import { useCallback, useEffect, useRef, useState } from 'react'
import { errorText } from '../../../shared/text/error'
import type { Convention, Conventions } from '../../../shared/types'
import { draftMessage } from '../../model/picker'

type Ai = { busy: boolean; found: Convention[] | null; error: string | null }

const idle: Ai = { busy: false, found: null, error: null }

export function useConventions(root: string | null, architecture: unknown) {
  const [state, setState] = useState<Conventions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ai, setAi] = useState<Ai>(idle)
  const asked = useRef(root)
  const reads = useRef(0)

  useEffect(() => {
    asked.current = root
    setAi(idle)
  }, [root])

  useEffect(() => {
    if (!root) return
    const read = ++reads.current
    window.architect.conventions(root).then(
      (next) => read === reads.current && (setState(next), setError(null)),
      (err: unknown) => read === reads.current && setError(errorText(err)),
    )
    return () => {
      reads.current++
    }
  }, [root, architecture])

  const toggle = useCallback(() => {
    if (!root || !state) return
    asked.current = state.enabled ? null : root
    setAi(idle)
    const read = ++reads.current
    window.architect.setConventions(root, !state.enabled).then(
      (next) => read === reads.current && setState(next),
      (err: unknown) => read === reads.current && setError(errorText(err)),
    )
  }, [root, state])

  const suggest = useCallback(() => {
    if (!root) return
    setAi({ busy: true, found: null, error: null })
    const settle = (next: Ai) => asked.current === root && setAi(next)
    window.architect.suggestConventions(root).then(
      (result) => settle(result.ok ? { busy: false, found: result.value, error: null } : { busy: false, found: null, error: draftMessage(result.error) }),
      (err: unknown) => settle({ busy: false, found: null, error: errorText(err) }),
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
        setError(errorText(err))
        return false
      }
    },
    [root],
  )

  return { state, error, ai, toggle, suggest, promote }
}
