export type Reach = { depth: Map<number, number>; parent: Map<number, number> }

function reverseOf(edges: number[][]): number[][] {
  const callers = edges.map((): number[] => [])
  edges.forEach((out, from) => out.forEach((to) => callers[to]?.push(from)))
  return callers
}

export function reachOf(edges: number[][], seeds: number[]): Reach {
  const callers = reverseOf(edges)
  const depth = new Map<number, number>(seeds.map((seed) => [seed, 0]))
  const parent = new Map<number, number>()
  let frontier = [...new Set(seeds)].sort((a, b) => a - b)

  for (let level = 1; frontier.length > 0; level += 1) {
    const next: number[] = []
    for (const node of frontier) {
      for (const caller of [...(callers[node] ?? [])].sort((a, b) => a - b)) {
        if (depth.has(caller)) continue
        depth.set(caller, level)
        parent.set(caller, node)
        next.push(caller)
      }
    }
    frontier = next.sort((a, b) => a - b)
  }
  return { depth, parent }
}
