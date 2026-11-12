import type { Graph, Hop, Node } from './nodes'

export type Walked = {
  caller: Node
  hop: Hop
  line: number
  times: number
  depth: number
  mark?: 'cycle' | 'repeat'
  more?: true
}

export const MOST_STEPS = 2000

function grouped(node: Node, graph: Graph): { hop: Hop; line: number; times: number }[] {
  const groups = new Map<string, { hop: Hop; line: number; times: number }>()
  for (const site of node.sites) {
    for (const hop of graph.hops(site)) {
      const held = groups.get(hop.node.key)
      if (held) held.times += 1
      else groups.set(hop.node.key, { hop, line: site.line, times: 1 })
    }
  }
  return [...groups.values()]
}

export function walk(start: Node, graph: Graph, depth: number, open: Set<string>): { steps: Walked[]; cut: boolean } {
  const steps: Walked[] = []
  const expanded = new Set<string>()
  const stack = new Set<string>()
  let cut = false

  const visit = (node: Node, level: number): void => {
    stack.add(node.key)
    expanded.add(node.key)
    for (const { hop, line, times } of grouped(node, graph)) {
      if (steps.length >= MOST_STEPS) {
        cut = true
        break
      }
      const target = hop.node
      const mark = stack.has(target.key) ? 'cycle' : expanded.has(target.key) ? 'repeat' : undefined
      const deeper = mark === undefined && target.sites.length > 0
      const fits = level + 1 < depth || open.has(target.key)
      steps.push({
        caller: node,
        hop,
        line,
        times,
        depth: level,
        ...(mark ? { mark } : {}),
        ...(deeper && !fits ? { more: true } : {}),
      })
      if (deeper && fits) visit(target, level + 1)
    }
    stack.delete(node.key)
  }

  visit(start, 0)
  return { steps, cut }
}
