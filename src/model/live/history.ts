import type { HistoryEntry } from '../../../shared/types'

export type Target = { kind: 'node'; id: string } | { kind: 'file'; path: string }

export type Moment = { label: string; at: number; entries: HistoryEntry[] }

const MARKS = { added: '+', changed: '~', removed: '−' } as const

export function merge(known: HistoryEntry[], incoming: HistoryEntry[]): HistoryEntry[] {
  const byId = new Map(known.map((e) => [e.id, e]))
  for (const e of incoming) byId.set(e.id, e)
  return [...byId.values()].sort((a, b) => b.at - a.at)
}

export function byMoment(entries: HistoryEntry[], now: number): Moment[] {
  const groups: Moment[] = []
  for (const entry of entries) {
    const label = ago(entry.at, now)
    const last = groups[groups.length - 1]
    if (last?.label === label) last.entries.push(entry)
    else groups.push({ label, at: entry.at, entries: [entry] })
  }
  return groups
}

export function ago(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / 1440)}d`
}

function nameOf(id: string): string {
  if (id.startsWith('folder:')) return `${id.slice('folder:'.length)}/`
  if (id.startsWith('codefile:')) return id.slice('codefile:'.length)
  const [from, to] = id.split('->')
  return to === undefined ? id : `${from} → ${to}`
}

export function lineOf(entry: HistoryEntry): string {
  const kinds = ['added', 'changed', 'removed'] as const
  const parts = kinds.flatMap((kind) =>
    entry[kind]
      .filter((id) => kind !== 'changed' || !id.startsWith('folder:'))
      .map((id) => `${MARKS[kind]} ${nameOf(id)}`)
  )
  if (parts.length === 0 && entry.file) return `~ ${entry.file}`
  return parts.join(', ')
}

export function targetOf(entry: HistoryEntry): Target | null {
  const live = [...entry.added, ...entry.changed]
  if (entry.source === 'code') {
    const file = entry.file ?? live.find((id) => id.startsWith('codefile:'))?.slice('codefile:'.length)
    return file ? { kind: 'file', path: file } : null
  }
  const node = live.find((id) => !id.includes('->')) ?? live[0]?.split('->')[0]
  return node ? { kind: 'node', id: node } : null
}
