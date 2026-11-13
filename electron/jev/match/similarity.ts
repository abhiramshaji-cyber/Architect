import type { Entry } from '../classify/cache'

export type Scored = { at: number; score: number }

function overlap(a: Entry['vector'], b: Entry['vector']): number {
  const shared = Object.keys(a).filter((id) => id in b)
  if (shared.length === 0) return 0
  return shared.reduce((product, id) => {
    const p = a[id] ?? {}
    const q = b[id] ?? {}
    const coefficient = Object.keys(p).reduce((sum, label) => sum + Math.sqrt(Math.max(0, p[label] ?? 0) * Math.max(0, q[label] ?? 0)), 0)
    return product * Math.min(1, coefficient)
  }, 1)
}

function aboveWidestDrop(sorted: Scored[]): Scored[] {
  if (sorted.length < 2) return sorted.filter((item) => item.score > 0)
  const median = sorted[Math.floor(sorted.length / 2)]?.score ?? 0
  const upper = sorted.filter((item) => item.score > median)

  let cut = upper.length
  let widest = -1
  upper.forEach((item, i) => {
    const below = upper[i + 1]?.score ?? median
    if (item.score - below > widest) {
      widest = item.score - below
      cut = i + 1
    }
  })
  return upper.slice(0, cut)
}

export function standoutsOf(subject: Entry, others: { at: number; entry: Entry }[]): Scored[] {
  const scored = others.filter(({ entry }) => entry.model === subject.model).map(({ at, entry }) => ({ at, score: overlap(subject.vector, entry.vector) }))
  return aboveWidestDrop(scored.sort((x, y) => y.score - x.score || x.at - y.at))
}
