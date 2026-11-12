import type { CoChange, CouplingAsk, CouplingPair } from '../../shared/types'
import type { Tally } from './pairs'

function coChange(tally: Tally, key: string, a: string, b: string): CoChange {
  const shared = tally.shared.get(key) ?? []
  const changes: [number, number] = [tally.counts.get(a) ?? 0, tally.counts.get(b) ?? 0]
  const least = Math.min(...changes)
  return { shared, changes, confidence: least > 0 ? shared.length / least : 0 }
}

function strong(change: CoChange, ask: CouplingAsk): boolean {
  return change.shared.length > 0 && change.shared.length >= ask.minShared && change.confidence >= ask.minConfidence
}

function order(x: CouplingPair, y: CouplingPair): number {
  const total = (p: CouplingPair) => p.commits.shared.length + p.sessions.shared.length
  const surest = (p: CouplingPair) => Math.max(p.commits.confidence, p.sessions.confidence)
  const [xa, xb] = x.files
  const [ya, yb] = y.files
  return total(y) - total(x) || surest(y) - surest(x) || (xa < ya ? -1 : xa > ya ? 1 : xb < yb ? -1 : xb > yb ? 1 : 0)
}

export function rankPairs(commits: Tally, sessions: Tally, linked: (a: string, b: string) => boolean, ask: CouplingAsk): CouplingPair[] {
  const keys = new Set([...commits.shared.keys(), ...sessions.shared.keys()])
  return [...keys]
    .flatMap((key): CouplingPair[] => {
      const [a = '', b = ''] = key.split('\0')
      if (linked(a, b)) return []
      const pair: CouplingPair = { files: [a, b], commits: coChange(commits, key, a, b), sessions: coChange(sessions, key, a, b) }
      return strong(pair.commits, ask) || strong(pair.sessions, ask) ? [pair] : []
    })
    .sort(order)
}
