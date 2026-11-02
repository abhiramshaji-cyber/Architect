import type { FunctionFacts, Importance } from '../../shared/types'

const DAMPING = 0.85
const ROUNDS = 100
const SETTLED = 1e-12
const CUTS = [0.2, 0.5, 0.8, 0.95]
const PRECISION = 1e9

export function pageRank(edges: number[][]): number[] {
  const n = edges.length
  let rank = new Array<number>(n).fill(1 / n)

  for (let round = 0; round < ROUNDS; round++) {
    const next = new Array<number>(n).fill(0)
    let stranded = 0
    edges.forEach((out, from) => {
      const share = rank[from] ?? 0
      if (out.length === 0) stranded += share
      for (const to of out) next[to] = (next[to] ?? 0) + share / out.length
    })

    const base = (1 - DAMPING + DAMPING * stranded) / n
    let moved = 0
    for (let at = 0; at < n; at++) {
      const value = base + DAMPING * (next[at] ?? 0)
      moved += Math.abs(value - (rank[at] ?? 0))
      next[at] = value
    }
    rank = next
    if (moved < SETTLED) break
  }

  return rank
}

export function scoreOf(fact: FunctionFacts, centrality: number): number {
  const root = fact.entry && fact.fanIn === 0
  return centrality + Math.log2(1 + fact.fanIn) + (fact.exported ? 1 : 0) + (root ? 2 : 0)
}

export function bucketed(scores: number[]): Importance[] {
  const keys = scores.map((score) => Math.round(score * PRECISION))
  const sorted = [...keys].sort((a, b) => a - b)
  const spans = new Map<number, { below: number; upto: number }>()
  sorted.forEach((key, at) => {
    const span = spans.get(key)
    if (span) span.upto = at + 1
    else spans.set(key, { below: at, upto: at + 1 })
  })

  return keys.map((key) => {
    const span = spans.get(key) ?? { below: 0, upto: keys.length }
    const percentile = (span.below + span.upto) / (2 * keys.length)
    return (1 + CUTS.filter((cut) => percentile >= cut).length) as Importance
  })
}

export function importanceOf(edges: number[][], facts: FunctionFacts[]): Importance[] {
  const ranks = pageRank(edges)
  return bucketed(facts.map((fact, at) => scoreOf(fact, (ranks[at] ?? 0) * facts.length)))
}
