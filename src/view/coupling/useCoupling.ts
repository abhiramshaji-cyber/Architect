import { useEffect, useState } from 'react'
import type { Coupling, CouplingAsk } from '../../../shared/types'
import { gitMessage } from '../../model/picker'

type Read = { key: string; coupling: Coupling | null; error: string | null }

export function useCoupling(root: string | null, ask: CouplingAsk, codeMap: unknown): Read | null {
  const [read, setRead] = useState<Read | null>(null)
  const key = `${root}\0${JSON.stringify(ask)}`

  useEffect(() => {
    if (!root || !codeMap) return
    let live = true
    window.architect.coupling(root, ask).then(
      (result) => live && setRead({ key, coupling: result.ok ? result.value : null, error: result.ok ? null : gitMessage(result.error) }),
      (err: unknown) => live && setRead({ key, coupling: null, error: err instanceof Error ? err.message : String(err) }),
    )
    return () => {
      live = false
    }
  }, [root, key, codeMap])

  return read?.key === key ? read : null
}
