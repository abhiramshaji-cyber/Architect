import { useCallback, useState } from 'react'

export function useWork<Kind extends string>() {
  const [busy, setBusy] = useState<Kind | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const act = useCallback(async (kind: Kind, run: () => Promise<string | null>) => {
    setBusy(kind)
    setNote(null)
    try {
      setNote(await run())
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }, [])

  return { busy, note, act }
}
