import { changeKey } from '../../../shared/recency'
import type { Change, FunctionRow } from '../../../shared/types'
import { ageOf } from '../../model/recency'

export type SortKey = 'importance' | 'lines' | 'name' | 'recent'

export type Placed = { row: FunctionRow; at: number; key: string }

const byName = (a: FunctionRow, b: FunctionRow) =>
  a.name.localeCompare(b.name) || a.file.localeCompare(b.file) || a.line - b.line

const byImportance = (a: FunctionRow, b: FunctionRow) =>
  b.importance - a.importance || b.fanIn - a.fanIn || b.lines - a.lines || byName(a, b)

const byLines = (a: FunctionRow, b: FunctionRow) => b.lines - a.lines || byName(a, b)

const COMPARE: Record<Exclude<SortKey, 'recent'>, (a: FunctionRow, b: FunctionRow) => number> = {
  importance: byImportance,
  lines: byLines,
  name: byName,
}

export function matches(row: FunctionRow, needle: string): boolean {
  if (needle === '') return true
  return [row.name, row.file, row.doc ?? ''].some((text) => text.toLowerCase().includes(needle))
}

export function changeOf(row: FunctionRow, changes: Record<string, Change>): Change | undefined {
  return changes[changeKey(row.file, row.line, row.name)]
}

export function arrange(rows: FunctionRow[], sort: SortKey, query: string, changes: Record<string, Change> = {}): Placed[] {
  const needle = query.trim().toLowerCase()
  const age = (row: FunctionRow) => {
    const change = changeOf(row, changes)
    return change === undefined ? -Infinity : ageOf(change)
  }
  const compare =
    sort === 'recent' ? (a: FunctionRow, b: FunctionRow) => Math.sign(age(b) - age(a)) || byName(a, b) : COMPARE[sort]
  return rows
    .map((row, at) => ({ row, at, key: `${at}:${row.file}:${row.line}` }))
    .filter(({ row }) => matches(row, needle))
    .sort((a, b) => compare(a.row, b.row))
}
