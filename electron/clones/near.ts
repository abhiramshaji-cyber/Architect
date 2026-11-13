import type { Shape } from './shape'

export type Pair = { a: number; b: number; similarity: number }

// NiCad and SourcererCC default: a near clone shares at least 70% of its normalized tokens, here of its syntax and of the outside names and literals it uses
export const FLOOR = 0.7

// under 16 shape tokens a body is a single call or expression, and one changed name already reads as a near clone
export const LEAST = 16

function overlap(a: Int32Array, b: Int32Array): number {
  let shared = 0
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      shared += 1
      i += 1
      j += 1
    } else if ((a[i] ?? 0) < (b[j] ?? 0)) i += 1
    else j += 1
  }
  return (2 * shared) / (a.length + b.length)
}

function shared(a: Set<number>, b: Set<number>): number {
  if (a.size + b.size === 0) return 1
  let both = 0
  for (const token of a) if (b.has(token)) both += 1
  return (2 * both) / (a.size + b.size)
}

export function similarity(a: number[], b: number[]): number {
  let above = new Uint32Array(b.length + 1)
  let row = new Uint32Array(b.length + 1)
  for (const token of a) {
    for (let j = 0; j < b.length; j += 1) row[j + 1] = token === b[j] ? (above[j] ?? 0) + 1 : Math.max(above[j + 1] ?? 0, row[j] ?? 0)
    ;[above, row] = [row, above]
  }
  return (2 * (above[b.length] ?? 0)) / (a.length + b.length)
}

export function pairsOf(shapes: Shape[]): Pair[] {
  const sized = shapes.flatMap(({ tokens, words }, at) => (tokens.length >= LEAST ? [{ at, shape: tokens, key: tokens.join(','), bag: Int32Array.from(tokens).sort(), words }] : []))
  sized.sort((x, y) => x.shape.length - y.shape.length)
  const reach = (2 - FLOOR) / FLOOR
  const pairs: Pair[] = []
  for (let i = 0; i < sized.length; i += 1) {
    const one = sized[i]
    if (!one) continue
    for (let j = i + 1; j < sized.length; j += 1) {
      const two = sized[j]
      if (!two || two.shape.length > one.shape.length * reach) break
      if (one.key !== two.key && (overlap(one.bag, two.bag) < FLOOR || shared(one.words, two.words) < FLOOR)) continue
      const score = one.key === two.key ? 1 : similarity(one.shape, two.shape)
      if (score >= FLOOR) pairs.push({ a: Math.min(one.at, two.at), b: Math.max(one.at, two.at), similarity: score })
    }
  }
  return pairs
}
