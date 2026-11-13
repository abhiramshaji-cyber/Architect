import { useCallback, useState } from 'react'
import { errorText } from '../../../shared/text/error'

export function useWork<Kind extends string>() {
  const [busy, setBusy] = useState<Kind | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const act = useCallback(async (kind: Kind, run: () => Promise<string | null>) => {
    setBusy(kind)
    setNote(null)
    try {
      setNote(await run())
    } catch (err) {
      setNote(errorText(err))
    } finally {
      setBusy(null)
    }
  }, [])

  return { busy, note, act }
}
