import type { MapNode } from './nest'

export function trail(root: MapNode, id: string): MapNode[] {
  if (root.id === id) return [root]
  for (const child of root.children) {
    const found = trail(child, id)
    if (found.length > 0) return [root, ...found]
  }
  return []
}
