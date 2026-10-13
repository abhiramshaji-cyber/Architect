import type { HistoryEntry } from '../../../shared/types'

export type Target = { kind: 'node'; id: string } | { kind: 'file'; path: string }

export type Moment = { label: string; at: number; entries: HistoryEntry[] }

export type Change = 'added' | 'changed' | 'removed'

export type Row = { entry: HistoryEntry; change: Change; name: string; parent: string; count: number }

const CHANGES = ['added', 'changed', 'removed'] as const

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

function split(file: string): { name: string; parent: string } {
  const cut = file.replace(/\/$/, '').lastIndexOf('/')
  return cut < 0 ? { name: file, parent: '' } : { name: file.slice(cut + 1), parent: file.slice(0, cut) }
}

export function rowOf(entry: HistoryEntry): Row | null {
  const items = CHANGES.flatMap((change) =>
    entry[change].filter((id) => change !== 'changed' || !id.startsWith('folder:')).map((id) => ({ change, id }))
  )
  const file = entry.source === 'code' ? (entry.file ?? items.find((i) => i.id.startsWith('codefile:'))?.id.slice('codefile:'.length)) : undefined

  if (file) {
    const change = items.find((i) => i.id === `codefile:${file}`)?.change ?? 'changed'
    return { entry, change, ...split(file), count: 1 }
  }
  const [first] = items
  if (!first) return null

  const change = items.every((i) => i.change === first.change) ? first.change : 'changed'
  if (items.length === 1 && entry.source === 'code') return { entry, change, ...split(nameOf(first.id)), count: 1 }
  return { entry, change, name: items.map((i) => nameOf(i.id)).join(', '), parent: '', count: 1 }
}

export function collapse(entries: HistoryEntry[]): Row[] {
  const rows: Row[] = []
  for (const row of entries.map(rowOf)) {
    if (!row) continue
    const last = rows[rows.length - 1]
    const same = last?.entry.source === row.entry.source && last.name === row.name && last.parent === row.parent
    if (same) rows[rows.length - 1] = { ...last, count: last.count + 1 }
    else rows.push(row)
  }
  return rows
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
