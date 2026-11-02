import type { FunctionRow, FunctionsReport } from '../../../shared/types'

export type SortKey = 'importance' | 'lines' | 'name'

export type Placed = { row: FunctionRow; key: string }

export function settled(report: FunctionsReport): boolean {
  return report.done >= report.total && report.rows.some((row) => row.rank !== null)
}

const byName = (a: FunctionRow, b: FunctionRow) =>
  a.name.localeCompare(b.name) || a.file.localeCompare(b.file) || a.line - b.line

const provisional = (a: FunctionRow, b: FunctionRow) => b.fanIn - a.fanIn || b.lines - a.lines || byName(a, b)

const ranked = (a: FunctionRow, b: FunctionRow) =>
  (b.rank?.importance ?? 0) - (a.rank?.importance ?? 0) || b.lines - a.lines || provisional(a, b)

const byLines = (a: FunctionRow, b: FunctionRow) => b.lines - a.lines || byName(a, b)

export function compareFor(sort: SortKey, final: boolean): (a: FunctionRow, b: FunctionRow) => number {
  if (sort === 'name') return byName
  if (sort === 'lines') return byLines
  return final ? ranked : provisional
}

export function matches(row: FunctionRow, needle: string): boolean {
  if (needle === '') return true
  return [row.name, row.file, row.rank?.summary ?? ''].some((text) => text.toLowerCase().includes(needle))
}

export function arrange(rows: FunctionRow[], sort: SortKey, final: boolean, query: string): Placed[] {
  const needle = query.trim().toLowerCase()
  const compare = compareFor(sort, final)
  return rows
    .map((row, at) => ({ row, key: `${at}:${row.file}:${row.line}` }))
    .filter(({ row }) => matches(row, needle))
    .sort((a, b) => compare(a.row, b.row))
}
