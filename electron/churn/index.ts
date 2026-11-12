import { type Churn, changeKey } from '../../shared/recency'
import type { CodeMap } from '../../shared/types'
import { type ChangeSet, type FileChange, type History, readHistory } from '../git/churn'
import { type Range, traceBack } from './trace'

const DAY = 86_400_000

const DEFAULT_DAYS = 90

type Tracked = { current: string; ranges: { key: string; range: Range }[] | null }

function windowOf(days: unknown): number {
  return typeof days === 'number' && Number.isFinite(days) && days >= 1 ? Math.min(Math.round(days), 36_500) : DEFAULT_DAYS
}

export function tally(history: History, map: CodeMap, days: number): Churn {
  const churn: Churn = { days, files: {}, functions: {}, ...(history.complete ? {} : { incomplete: true as const }) }
  const tracked = new Map<string, Tracked>()
  const closed = new Set<string>()
  for (const file of map.folders.flatMap((folder) => folder.files)) {
    const ranges = file.functions.map((fn) => ({ key: changeKey(file.path, fn.line, fn.name), range: { from: fn.line - 1, to: fn.endLine } }))
    tracked.set(file.path, { current: file.path, ranges })
  }

  function count(entry: Tracked, change: FileChange) {
    const known = churn.files[entry.current] ?? { commits: 0, added: 0, removed: 0 }
    const binary = known.binary || change.binary ? { binary: true as const } : {}
    churn.files[entry.current] = { commits: known.commits + 1, added: known.added + change.added, removed: known.removed + change.removed, ...binary }
  }

  function trace(entry: Tracked, change: FileChange, counted: boolean) {
    if (!entry.ranges || !change.hunks || change.binary) {
      entry.ranges = null
      return
    }
    const hunks = change.hunks
    entry.ranges = entry.ranges.flatMap(({ key, range }) => {
      const { touched, parent } = traceBack(range, hunks)
      if (touched && counted) churn.functions[key] = (churn.functions[key] ?? 0) + 1
      return parent ? [{ key, range: parent }] : []
    })
  }

  function step(set: ChangeSet, counted: boolean) {
    const moved: [string, Tracked][] = []
    const shut: string[] = []
    for (const change of set.files) {
      const entry = tracked.get(change.path) ?? (closed.has(change.path) || change.deleted ? null : { current: change.path, ranges: [] })
      tracked.delete(change.path)
      if (change.deleted || change.created || change.from !== undefined) shut.push(change.path)
      if (!entry || change.deleted) continue

      if (counted) count(entry, change)
      trace(entry, change, counted)
      if (!change.created) moved.push([change.from ?? change.path, entry])
    }
    for (const path of shut) closed.add(path)
    for (const [path, entry] of moved) {
      closed.delete(path)
      tracked.set(path, entry)
    }
  }

  if (history.working) step(history.working, false)
  for (const commit of history.commits) step(commit, true)
  return churn
}

export async function churnOf(root: string, map: CodeMap, days?: unknown): Promise<Churn> {
  const window = windowOf(days)
  const since = Math.floor(Date.now() / DAY) * DAY - window * DAY
  return tally(await readHistory(root, since), map, window)
}
