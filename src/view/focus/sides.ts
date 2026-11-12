import type { FunctionList, FunctionRow } from '../../../shared/types'
import { outsideOf, type Way } from '../functions/facts/calls'

export const FIRST = 10

export const PAGE = 50

export type Side = { shown: number[]; more: number; outside: number }

export type Sides = { callers: Side; callees: Side; mutual: Set<number> }

export type Limits = Record<Way, number>

export function byRank(rows: FunctionRow[]) {
  return (a: number, b: number): number => {
    const x = rows[a]
    const y = rows[b]
    if (!x || !y) return a - b
    return (
      y.importance - x.importance ||
      y.fanIn - x.fanIn ||
      x.name.localeCompare(y.name) ||
      x.file.localeCompare(y.file) ||
      x.line - y.line ||
      a - b
    )
  }
}

function sideOf(rows: FunctionRow[], ats: number[], limit: number, outside: number): Side {
  const ranked = [...new Set(ats)].filter((at) => rows[at] !== undefined).sort(byRank(rows))
  const cap = Math.max(0, Math.floor(limit))
  return { shown: ranked.slice(0, cap), more: Math.max(0, ranked.length - cap), outside }
}

export function sidesOf(list: FunctionList, callers: number[][], at: number, limits: Limits): Sides | null {
  const row = list.rows[at]
  if (!row) return null
  const into = callers[at] ?? []
  const out = list.calls[at] ?? []
  const back = new Set(out)
  return {
    callers: sideOf(list.rows, into, limits.callers, outsideOf(row, 'callers')),
    callees: sideOf(list.rows, out, limits.callees, outsideOf(row, 'callees')),
    mutual: new Set(into.filter((from) => back.has(from))),
  }
}
