import type { Change } from '../../shared/types'

export const STEPS = 5

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
]

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export const ageOf = (change: Change): number => (change === 'uncommitted' ? Infinity : change.at)

export function ranker(changes: Iterable<Change>): (change: Change | undefined) => number | undefined {
  const distinct = [...new Set([...changes].map(ageOf))].sort((a, b) => b - a)
  const place = new Map(distinct.map((age, at) => [age, at]))
  const span = Math.max(1, distinct.length - 1)
  return (change) => {
    const at = change === undefined ? undefined : place.get(ageOf(change))
    return at === undefined ? undefined : Math.min(STEPS - 1, Math.floor((at / span) * STEPS))
  }
}

export function agoOf(at: number, now: number): string {
  const gap = at - now
  const unit = UNITS.find(([, ms]) => Math.abs(gap) >= ms)
  return unit ? relative.format(Math.round(gap / unit[1]), unit[0]) : 'just now'
}

export function describeChange(change: Change | undefined, now: number): string | undefined {
  if (change === undefined) return undefined
  if (change === 'uncommitted') return 'Uncommitted changes'
  const when = `Changed ${agoOf(change.at, now)}`
  return change.subject === '' ? when : `${when}: ${change.subject}`
}
