import type { Graph, Hop, Node } from './nodes'

export type Walked = {
  caller: Node
  hop: Hop
  lines: number[]
  depth: number
  mark?: 'cycle' | 'repeat'
  more?: true
}

export const MOST_STEPS = 2000

function grouped(node: Node, graph: Graph): { hop: Hop; lines: number[] }[] {
  const groups = new Map<string, { hop: Hop; lines: number[] }>()
  for (const site of node.sites) {
    for (const hop of graph.hops(site)) {
      const held = groups.get(hop.node.key)
      if (held) held.lines.push(site.line)
      else groups.set(hop.node.key, { hop, lines: [site.line] })
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
    for (const { hop, lines } of grouped(node, graph)) {
      if (steps.length >= MOST_STEPS) {
        cut = true
        break
      }
      const target = hop.node
      const mark = stack.has(target.key) ? 'cycle' : expanded.has(target.key) ? 'repeat' : undefined
      const deeper = mark === undefined && grouped(target, graph).length > 0
      const fits = level + 1 < depth || open.has(target.key)
      steps.push({
        caller: node,
        hop,
        lines,
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
