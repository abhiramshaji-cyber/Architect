import { useEffect, useState } from 'react'
import type { Commit, VerdictRecord } from '../../../shared/types'
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

async function read(root: string, days: number, held: Stored | null): Promise<Stored> {
  const verdicts = await window.architect.verdicts(root)
  if (held) return { ...held, verdicts }
  const start = Date.now() - days * DAY_MS
  const log = await window.architect.gitCommits(root, start, LIMIT + 1)
  if (!log.ok) return { root, days, since: start, commits: [], capped: false, verdicts, error: gitMessage(log.error) }
  const capped = log.value.length > LIMIT
  const commits = log.value.slice(0, LIMIT)
  const since = capped ? commits.reduce((low, commit) => Math.min(low, commit.at), Infinity) : start
  return { root, days, since, commits, capped, verdicts, error: null }
}

const POLL_MS = 5000

const LOG_EVERY = 6

const sameAs = (a: Stored | null, b: Stored) =>
  a !== null &&
  a.root === b.root &&
  a.days === b.days &&
  a.error === b.error &&
  a.commits.length === b.commits.length &&
  a.commits[0]?.sha === b.commits[0]?.sha &&
  a.verdicts.length === b.verdicts.length &&
  a.verdicts[0]?.id === b.verdicts[0]?.id

export function useReplay(root: string | null, days: number): Stored | null {
  const [stored, setStored] = useState<Stored | null>(null)

  useEffect(() => {
    if (!root) return
    let live = true
    let busy = false
    let ticks = 0
    let last: Stored | null = null
    const keep = (found: Stored) => {
      last = found.error === null ? found : null
      if (live) setStored((held) => (sameAs(held, found) ? held : found))
    }
    const refresh = (full: boolean) => {
      if (busy || document.visibilityState === 'hidden') return
      busy = true
      ticks += 1
      read(root, days, full || ticks % LOG_EVERY === 0 ? null : last)
        .then(keep, (err: unknown) =>
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
        .finally(() => {
          busy = false
        })
    }

    const now = () => refresh(true)
    now()
    const timer = setInterval(() => refresh(false), POLL_MS)
    window.addEventListener('focus', now)
    document.addEventListener('visibilitychange', now)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('focus', now)
      document.removeEventListener('visibilitychange', now)
    }
  }, [root, days])

  return stored?.root === root && stored.days === days ? stored : null
}
