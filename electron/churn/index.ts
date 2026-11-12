import { type Churn, changeKey } from '../../shared/recency'
import type { CodeMap, FunctionEntry } from '../../shared/types'
import { type ChangeSet, type FileChange, type History, type Hunk, readHistory } from '../git/churn'
import { carry, type Span } from './carry'

const DAY = 86_400_000

const DEFAULT_DAYS = 90

function windowOf(days: unknown): number {
  return typeof days === 'number' && Number.isFinite(days) && days >= 1 ? Math.min(Math.round(days), 36_500) : DEFAULT_DAYS
}

function spansOf(hunks: Hunk[]): Span[] {
  return hunks.map((hunk) => {
    const from = hunk.newCount > 0 ? hunk.newStart - 1 : hunk.newStart
    return hunk.newCount > 0 ? { from, to: from + hunk.newCount } : { from, to: from, gap: true }
  })
}

function touches(span: Span, fn: FunctionEntry): boolean {
  const start = fn.line - 1
  if (span.gap) return start < span.from && span.to < fn.endLine
  return span.from < fn.endLine && span.to > start
}

export function tally(history: History, map: CodeMap, days: number): Churn {
  const functions = new Map(map.folders.flatMap((folder) => folder.files.map((file) => [file.path, file.functions] as const)))
  const names = new Map<string, string | null>()
  const newer = new Map<string, Hunk[][] | null>()
  const churn: Churn = { days, files: {}, functions: {} }

  function follow(change: FileChange): string | null {
    const current = names.has(change.path) ? (names.get(change.path) ?? null) : change.path
    if (current !== null && change.from !== undefined) names.set(change.from, current)
    if (change.created || change.deleted || change.from !== undefined) names.set(change.path, null)
    return change.deleted ? null : current
  }

  function attribute(current: string, change: FileChange) {
    const chain = newer.has(current) ? newer.get(current) : []
    if (!chain || !change.hunks || change.binary) return newer.set(current, null)

    const forward = [...chain].reverse()
    const spans = spansOf(change.hunks).flatMap((span) => carry(span, forward))
    for (const fn of functions.get(current) ?? []) {
      const key = changeKey(current, fn.line, fn.name)
      if (spans.some((span) => touches(span, fn))) churn.functions[key] = (churn.functions[key] ?? 0) + 1
    }
    newer.set(current, [...chain, change.hunks])
  }

  function absorb(set: ChangeSet, counted: boolean) {
    for (const change of set.files) {
      const current = follow(change)
      if (current === null) continue
      if (counted) {
        const known = churn.files[current] ?? { commits: 0, added: 0, removed: 0 }
        churn.files[current] = { commits: known.commits + 1, added: known.added + change.added, removed: known.removed + change.removed, ...(known.binary || change.binary ? { binary: true as const } : {}) }
      }
      if (counted) attribute(current, change)
      else newer.set(current, change.hunks && !change.binary ? [change.hunks] : null)
    }
  }

  if (history.working) absorb(history.working, false)
  for (const commit of history.commits) absorb(commit, true)
  return churn
}

export async function churnOf(root: string, map: CodeMap, days?: unknown): Promise<Churn> {
  const window = windowOf(days)
  const since = Math.floor(Date.now() / DAY) * DAY - window * DAY
  return tally(await readHistory(root, since), map, window)
}
