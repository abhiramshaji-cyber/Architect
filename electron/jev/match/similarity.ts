import type { Entry } from '../classify/cache'
import { BEHAVIOR_QUESTIONS } from '../classify/questions'

export type Scored = { at: number; score: number }

function coefficient(p: Record<string, number>, q: Record<string, number>): number {
  return Math.min(1, Object.keys(p).reduce((sum, label) => sum + Math.sqrt(Math.max(0, p[label] ?? 0) * Math.max(0, q[label] ?? 0)), 0))
}

export function behaviorOverlap(a: Entry['vector'], b: Entry['vector']): number {
  const shared = BEHAVIOR_QUESTIONS.filter((id) => a[id] && b[id])
  if (shared.length === 0) return 0
  return shared.reduce((product, id) => product * coefficient(a[id] ?? {}, b[id] ?? {}), 1)
}

export function topCluster(sorted: Scored[]): Scored[] {
  const n = sorted.length
  const total = sorted.reduce((sum, item) => sum + item.score, 0)
  let best = 0
  let cut = n
  let head = 0
  for (let i = 1; i < n; i += 1) {
    head += sorted[i - 1]?.score ?? 0
    if (sorted[i - 1]?.score === sorted[i]?.score) continue
    const between = (i / n) * ((n - i) / n) * (head / i - (total - head) / (n - i)) ** 2
    if (between > best) {
      best = between
      cut = i
    }
  }
  return sorted.slice(0, cut).filter((item) => item.score > 0)
}

export function standoutsOf(subject: Entry, others: { at: number; entry: Entry }[]): Scored[] {
  const scored = others.filter(({ entry }) => entry.model === subject.model).map(({ at, entry }) => ({ at, score: behaviorOverlap(subject.vector, entry.vector) }))
  return topCluster(scored.sort((x, y) => y.score - x.score || x.at - y.at))
}
