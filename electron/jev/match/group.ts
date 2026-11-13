import { CONFIRMED, POSSIBLE } from '../../../shared/jev/types'
import type { Pair } from '../classify/cache'

type Link = { a: number; b: number; probability: number }

export type Member = { at: number; probability: number; via: number | null }

function rootOf(parent: Map<number, number>, at: number): number {
  let top = at
  while ((parent.get(top) ?? top) !== top) top = parent.get(top) ?? top
  parent.set(at, top)
  return top
}

const strongest = (links: Link[]) => links.reduce<Link | null>((best, link) => (best && best.probability >= link.probability ? best : link), null)

const otherEnd = (link: Link, at: number) => (link.a === at ? link.b : link.a)

export function groupOf(subject: number, pairs: Iterable<Pair>, atOf: Map<string, number>, model: string): { group: Member[]; possible: Member[] } {
  const links = [...pairs].flatMap((pair): Link[] => {
    const a = atOf.get(pair.a)
    const b = atOf.get(pair.b)
    return pair.model === model && a !== undefined && b !== undefined && a !== b ? [{ a, b, probability: pair.noul }] : []
  })

  const confirmed = links.filter((link) => link.probability > CONFIRMED)
  const parent = new Map<number, number>()
  for (const { a, b } of confirmed) parent.set(rootOf(parent, a), rootOf(parent, b))
  const home = rootOf(parent, subject)
  const inGroup = new Set([...parent.keys()].filter((at) => at !== subject && rootOf(parent, at) === home))
  const group = [...inGroup].flatMap((at): Member[] => {
    const touching = confirmed.filter((link) => link.a === at || link.b === at)
    const direct = strongest(touching.filter((link) => otherEnd(link, at) === subject))
    if (direct) return [{ at, probability: direct.probability, via: null }]
    const joined = strongest(touching.filter((link) => inGroup.has(otherEnd(link, at))))
    return joined ? [{ at, probability: joined.probability, via: otherEnd(joined, at) }] : []
  })

  const near = new Map<number, number>()
  for (const link of links) {
    const other = otherEnd(link, subject)
    const touches = link.a === subject || link.b === subject
    if (touches && link.probability >= POSSIBLE && link.probability <= CONFIRMED && !inGroup.has(other)) near.set(other, Math.max(near.get(other) ?? 0, link.probability))
  }
  return { group, possible: [...near].map(([at, probability]) => ({ at, probability, via: null })) }
}
