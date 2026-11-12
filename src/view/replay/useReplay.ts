import { useEffect, useState } from 'react'
import type { Commit, HistoryEntry, VerdictRecord } from '../../../shared/types'
import { gitMessage } from '../../model/picker'

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

async function read(root: string, days: number): Promise<Stored> {
  const start = Date.now() - days * DAY_MS
  const [log, verdicts] = await Promise.all([
    window.architect.gitCommits(root, start, LIMIT + 1),
    window.architect.verdicts(root),
  ])
  if (!log.ok) return { root, days, since: start, commits: [], capped: false, verdicts, error: gitMessage(log.error) }
  const capped = log.value.length > LIMIT
  const commits = log.value.slice(0, LIMIT)
  const since = capped ? (commits.at(-1)?.at ?? start) : start
  return { root, days, since, commits, capped, verdicts, error: null }
}

const POLL_MS = 5000

const sameAs = (a: Stored | null, b: Stored) =>
  a !== null &&
  a.root === b.root &&
  a.days === b.days &&
  a.error === b.error &&
  a.commits.length === b.commits.length &&
  a.commits[0]?.sha === b.commits[0]?.sha &&
  a.verdicts.length === b.verdicts.length &&
  a.verdicts[0]?.id === b.verdicts[0]?.id

export function useReplay(root: string | null, days: number, history: HistoryEntry[]): Stored | null {
  const [stored, setStored] = useState<Stored | null>(null)

  useEffect(() => {
    if (!root) return
    let live = true
    const keep = (found: Stored) => live && setStored((held) => (sameAs(held, found) ? held : found))
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      read(root, days).then(keep, (err: unknown) =>
        keep({
          root,
          days,
          since: Date.now() - days * DAY_MS,
          commits: [],
          capped: false,
          verdicts: [],
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }

    refresh()
    const timer = setInterval(refresh, POLL_MS)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [root, days, history])

  return stored?.root === root && stored.days === days ? stored : null
}
