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

export type Step = { to: string } | 'back' | 'forward'

export function walk(trail: Trail | null, step: Step): Trail | null {
  if (step === 'back') {
    const now = trail?.back.at(-1)
    return !trail || now === undefined ? trail : { back: trail.back.slice(0, -1), now, forward: [trail.now, ...trail.forward] }
  }
  if (step === 'forward') {
    const [now, ...rest] = trail?.forward ?? []
    return !trail || now === undefined ? trail : { back: [...trail.back, trail.now], now, forward: rest }
  }
  if (!trail) return { back: [], now: step.to, forward: [] }
  if (trail.now === step.to) return trail
  return { back: [...trail.back, trail.now], now: step.to, forward: [] }
}
