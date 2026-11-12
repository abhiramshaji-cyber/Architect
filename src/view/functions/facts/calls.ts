import type { FunctionList, FunctionRow } from '../../../../shared/types'

export type Way = 'callers' | 'callees'

export type Asked = { at: number; way: Way }

export type Shown = { row: FunctionRow; related: { at: number; row: FunctionRow }[]; outside: number }

export function callersOf(calls: number[][]): number[][] {
  const callers = calls.map((): number[] => [])
  calls.forEach((out, from) => {
    for (const to of out) callers[to]?.push(from)
  })
  return callers
}

export function outsideOf(row: FunctionRow, way: Way): number {
  return (way === 'callers' ? row.outsideCallers : row.outsideCallees) ?? 0
}

export function shownOf(list: FunctionList, callers: number[][], asked: Asked): Shown | null {
  const row = list.rows[asked.at]
  if (!row) return null
  const ats = (asked.way === 'callers' ? callers : list.calls)[asked.at] ?? []
  const related = ats.flatMap((at) => {
    const other = list.rows[at]
    return other ? [{ at, row: other }] : []
  })
  return { row, related, outside: outsideOf(row, asked.way) }
}
