import type { FunctionRow } from '../../../shared/types'

export type SortKey = 'importance' | 'lines' | 'name'

export type Placed = { row: FunctionRow; key: string }

const byName = (a: FunctionRow, b: FunctionRow) =>
  a.name.localeCompare(b.name) || a.file.localeCompare(b.file) || a.line - b.line

const byImportance = (a: FunctionRow, b: FunctionRow) =>
  b.importance - a.importance || b.fanIn - a.fanIn || b.lines - a.lines || byName(a, b)

const byLines = (a: FunctionRow, b: FunctionRow) => b.lines - a.lines || byName(a, b)

const COMPARE: Record<SortKey, (a: FunctionRow, b: FunctionRow) => number> = {
  importance: byImportance,
  lines: byLines,
  name: byName,
}

export function matches(row: FunctionRow, needle: string): boolean {
  if (needle === '') return true
  return [row.name, row.file, row.summary].some((text) => text.toLowerCase().includes(needle))
}

export function arrange(rows: FunctionRow[], sort: SortKey, query: string): Placed[] {
  const needle = query.trim().toLowerCase()
  return rows
    .map((row, at) => ({ row, key: `${at}:${row.file}:${row.line}` }))
    .filter(({ row }) => matches(row, needle))
    .sort((a, b) => COMPARE[sort](a.row, b.row))
}
