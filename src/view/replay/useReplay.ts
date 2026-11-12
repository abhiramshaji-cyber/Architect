import { useEffect, useState } from 'react'
import type { Commit, HistoryEntry, VerdictRecord } from '../../../shared/types'

export const LIMIT = 1000

const DAY_MS = 24 * 60 * 60 * 1000

export type Stored = {
  root: string
  days: number
  since: number
  commits: Commit[]
  capped: boolean
  verdicts: VerdictRecord[]
  error: string | null
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function read(root: string, days: number): Promise<Stored> {
  const window = Date.now() - days * DAY_MS
  const [log, verdicts] = await Promise.all([
    window_.architect.gitCommits(root, window, LIMIT + 1),
    window_.architect.verdicts(root).catch(() => []),
  ])
  if (!log.ok)
    return {
      root,
      days,
      since: window,
      commits: [],
      capped: false,
      verdicts,
      error: log.error.message,
    }
  const capped = log.value.length > LIMIT
  const commits = log.value.slice(0, LIMIT)
  const since = capped ? (commits.at(-1)?.at ?? window) : window
  return { root, days, since, commits, capped, verdicts, error: null }
}

const window_ = globalThis.window

export function useReplay(root: string | null, days: number, history: HistoryEntry[]): Stored | null {
  const [stored, setStored] = useState<Stored | null>(null)

  useEffect(() => {
    if (!root) return
    let live = true
    read(root, days).then(
      (found) => live && setStored(found),
      (err: unknown) =>
        live &&
        setStored({
          root,
          days,
          since: Date.now(),
          commits: [],
          capped: false,
          verdicts: [],
          error: messageOf(err),
        }),
    )
    return () => {
      live = false
    }
  }, [root, days, history])

  return stored?.root === root && stored.days === days ? stored : null
}
