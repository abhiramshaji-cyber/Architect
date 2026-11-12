import type { Way } from '../functions/facts/calls'
import type { Sides } from './sides'

export type Item =
  | { id: string; kind: 'fn'; at: number; way: Way | null; mutual: boolean }
  | { id: string; kind: 'more' | 'outside'; way: Way; count: number }

export type Link = { from: string; to: string; kind: 'call' | 'mutual' | 'cross' }

export const CENTER = 'center'

export const SIDE_H = 84

const PREFIX: Record<Way, string> = { callers: 'in', callees: 'out' }

function sideItems(sides: Sides, way: Way): Item[] {
  const side = sides[way]
  const id = (tail: string | number) => `${PREFIX[way]}:${tail}`
  const fns: Item[] = side.shown.map((at) => ({ id: id(at), kind: 'fn', at, way, mutual: sides.mutual.has(at) }))
  const more: Item[] = side.more > 0 ? [{ id: id('more'), kind: 'more', way, count: side.more }] : []
  const outside: Item[] = side.outside > 0 ? [{ id: id('outside'), kind: 'outside', way, count: side.outside }] : []
  return [...fns, ...more, ...outside]
}

function linkOf(item: Item): Link {
  const kind = item.kind === 'outside' ? 'cross' : item.kind === 'fn' && item.mutual ? 'mutual' : 'call'
  return item.way === 'callers' ? { from: item.id, to: CENTER, kind } : { from: CENTER, to: item.id, kind }
}

export function graphOf(at: number, sides: Sides): { items: Item[]; links: Link[] } {
  const callers = sideItems(sides, 'callers')
  const callees = sideItems(sides, 'callees')
  const center: Item = { id: CENTER, kind: 'fn', at, way: null, mutual: false }
  return { items: [...callers, center, ...callees], links: [...callers, ...callees].map(linkOf) }
}
