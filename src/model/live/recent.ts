import type { HistoryEntry } from '../../../shared/types'

export type LiveKind = 'added' | 'changed' | 'removed'

export type Recent = Record<string, { kind: LiveKind; at: number }>

export const LIVE_MS = 2500

export function absorb(recent: Recent, entry: HistoryEntry, now: number): Recent {
  const next = { ...recent }
  const mark = (id: string, kind: LiveKind) => {
    const settling = next[id]?.kind === 'added' && kind === 'changed'
    next[id] = { kind: settling ? 'added' : kind, at: now }
  }
  for (const id of entry.added) mark(id, 'added')
  for (const id of entry.changed) mark(id, 'changed')
  for (const id of entry.removed) mark(id, 'removed')
  return next
}

export function prune(recent: Recent, now: number): Recent {
  return Object.fromEntries(Object.entries(recent).filter(([, mark]) => now - mark.at < LIVE_MS))
}

export function liveClass(recent: Recent, id: string): string | undefined {
  const mark = recent[id]
  return mark ? `live-${mark.kind}` : undefined
}

export function addedIds(recent: Recent): string[] {
  return Object.keys(recent).filter((id) => recent[id]?.kind === 'added')
}
