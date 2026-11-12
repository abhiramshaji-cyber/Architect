import type { Edge, LayerRow } from '../../shared/types'

function strongComponents(nodes: string[], edges: Edge[]): string[][] {
  const next = new Map(nodes.map((node) => [node, [] as string[]]))
  for (const e of edges) if (next.has(e.to)) next.get(e.from)?.push(e.to)

  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const found: string[][] = []

  // tarjan
  const visit = (node: string) => {
    index.set(node, index.size)
    low.set(node, index.get(node) as number)
    stack.push(node)
    onStack.add(node)
    for (const to of next.get(node) ?? []) {
      if (!index.has(to)) visit(to)
      if (onStack.has(to)) low.set(node, Math.min(low.get(node) as number, low.get(to) as number))
    }
    if (low.get(node) !== index.get(node)) return
    const block: string[] = []
    let top: string
    do {
      top = stack.pop() as string
      onStack.delete(top)
      block.push(top)
    } while (top !== node)
    found.push(block.sort())
  }

  for (const node of nodes) if (!index.has(node)) visit(node)
  return found
}

export function levelize(ids: string[], calls: Edge[]): LayerRow[] {
  const blocks = strongComponents([...new Set(ids)].sort(), calls)
  const blockOf = new Map(blocks.flatMap((members, at) => members.map((id) => [id, at] as const)))
  const level: number[] = []

  // tarjan emits every block after the blocks it calls, so their levels are already set
  for (const [at, members] of blocks.entries()) {
    const inside = new Set(members)
    const below = calls
      .filter((e) => inside.has(e.from) && !inside.has(e.to) && blockOf.has(e.to))
      .reduce((top, e) => Math.max(top, level[blockOf.get(e.to) as number] as number), 0)
    level[at] = 1 + below
  }

  return blocks
    .map((members, at) => ({ members, at, level: level[at] as number }))
    .sort((a, b) => a.level - b.level || (a.members[0] as string).localeCompare(b.members[0] as string))
    .flatMap(({ members, level }, block) => members.map((id) => ({ id, level, block })))
}
