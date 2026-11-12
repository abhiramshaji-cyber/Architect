import { randomUUID } from 'node:crypto'
import { HOOK_DEADLINE_MS } from '../../shared/socket'
import type { CodeMap, HistoryEntry } from '../../shared/types'
import { attribute, type Attributed, codeDiff, type Diff, isEmpty, reclaim, type Touch } from './history'

type Journal = {
  list(root: string): HistoryEntry[]
  append(root: string, entry: HistoryEntry): HistoryEntry[]
  replace(root: string, old: HistoryEntry, next: HistoryEntry[]): HistoryEntry[]
}

const filesIn = (change: Diff) =>
  [...change.added, ...change.changed, ...change.removed].filter((id) => id.startsWith('codefile:')).map((id) => id.slice('codefile:'.length))

export function createClaims(journal: Journal, limit: number, emit: (entry: HistoryEntry) => void) {
  const recorded = new Map<string, { at: number; digests: Map<string, string> }>()

  function remember(id: string, change: Diff, digests: Map<string, string>) {
    const named = filesIn(change).flatMap((file) => {
      const digest = digests.get(file)
      return digest === undefined ? [] : [[file, digest] as const]
    })
    recorded.set(id, { at: Date.now(), digests: new Map(named) })
    for (const known of recorded.keys()) {
      if (recorded.size <= limit) break
      recorded.delete(known)
    }
  }

  function claimed(root: string, touch: Touch, touched: Touch[], moved: Diff): boolean {
    const { file, session, at, digest } = touch
    if (!session || at === undefined || !digest) return false
    if (touched.some((other) => other.file === file && other.session !== session)) return false
    if (filesIn(moved).includes(file)) return false

    const found = reclaim(journal.list(root), file, session, (entry) => {
      const saved = recorded.get(entry.id)
      return saved !== undefined && saved.at >= at - HOOK_DEADLINE_MS && saved.digests.get(file) === digest
    })
    if (!found) return false
    journal.replace(root, found.found, found.parts)
    for (const part of [...found.parts].reverse()) emit(part)
    return true
  }

  function changes(root: string, before: CodeMap, after: CodeMap, touched: Touch[]): Attributed[] {
    const moved = codeDiff(before, after)
    const fresh = touched.filter((touch) => !claimed(root, touch, touched, moved))
    return attribute(codeDiff(before, after, fresh.map((touch) => touch.file)), fresh)
  }

  function record(root: string, source: HistoryEntry['source'], change: Attributed, at = Date.now(), digests = new Map<string, string>()) {
    if (isEmpty(change)) return

    const entry: HistoryEntry = { id: randomUUID(), root, at, source, ...change }
    journal.append(root, entry)
    if (source === 'code') remember(entry.id, change, digests)
    emit(entry)
  }

  return { record, changes }
}
