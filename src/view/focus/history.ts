import type { FunctionRow } from '../../../shared/types'

export type Trail = { back: string[]; now: string; forward: string[] }

export function keyOf(row: FunctionRow): string {
  return `${row.file}\0${row.line}\0${row.name}`
}

export function placeOf(key: string): string {
  const [file, , name] = key.split('\0')
  return `${file}\0${name}`
}

export function resolve(rows: FunctionRow[], key: string): number {
  const exact = rows.findIndex((row) => keyOf(row) === key)
  if (exact >= 0) return exact
  const place = placeOf(key)
  const same = rows.flatMap((row, at) => (placeOf(keyOf(row)) === place ? [at] : []))
  return same.length === 1 ? (same[0] ?? -1) : -1
}

export function go(trail: Trail | null, key: string): Trail {
  if (!trail) return { back: [], now: key, forward: [] }
  if (trail.now === key) return trail
  return { back: [...trail.back, trail.now], now: key, forward: [] }
}

export function back(trail: Trail): Trail {
  const now = trail.back.at(-1)
  return now === undefined ? trail : { back: trail.back.slice(0, -1), now, forward: [trail.now, ...trail.forward] }
}

export function forward(trail: Trail): Trail {
  const [now, ...rest] = trail.forward
  return now === undefined ? trail : { back: [...trail.back, trail.now], now, forward: rest }
}
