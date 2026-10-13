export type Spot = { path: string; line: number }

export type Trail = { back: Spot[]; forward: Spot[] }

export const EMPTY_TRAIL: Trail = { back: [], forward: [] }

const KEPT = 50

function same(a: Spot, b: Spot): boolean {
  return a.path === b.path && a.line === b.line
}

export function leave(trail: Trail, from: Spot): Trail {
  const last = trail.back.at(-1)
  const back = last && same(last, from) ? trail.back : [...trail.back, from].slice(-KEPT)
  return { back, forward: [] }
}

export function retreat(trail: Trail, here: Spot): { trail: Trail; to: Spot } | null {
  const to = trail.back.at(-1)
  if (!to) return null
  return { trail: { back: trail.back.slice(0, -1), forward: [...trail.forward, here] }, to }
}

export function advance(trail: Trail, here: Spot): { trail: Trail; to: Spot } | null {
  const to = trail.forward.at(-1)
  if (!to) return null
  return { trail: { back: [...trail.back, here], forward: trail.forward.slice(0, -1) }, to }
}
