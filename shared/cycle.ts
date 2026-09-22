import type { Edge } from './types'

// bfs-back
export function findCycle(edges: Edge[], from: string, to: string): string[] | null {
  if (from === to) return [from, from]

  const parent = new Map<string, string>([[to, to]])
  const queue = [to]

  while (queue.length > 0) {
    const current = queue.shift() as string
    if (current === from) {
      const backward = [from]
      let node = from
      while (node !== to) {
        node = parent.get(node) as string
        backward.push(node)
      }
      const forward = backward.reverse()
      return [from, to, ...forward.slice(1, -1), from]
    }
    for (const e of edges) {
      if (e.from === current && !parent.has(e.to)) {
        parent.set(e.to, current)
        queue.push(e.to)
      }
    }
  }
  return null
}
