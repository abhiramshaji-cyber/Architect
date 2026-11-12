import type { MapNode } from '../../map/layout/nest'
import type { Step } from './steps'

export type Lit = { values: Map<string, number | null>; found: number }

export function light(root: MapNode, steps: Step[], at: number): Lit {
  const step = steps[at]
  const files = new Set(step?.files ?? [])
  const components = new Set(step?.components ?? [])
  const before = new Set(steps.slice(0, Math.max(0, at)).flatMap((earlier) => earlier.files))
  const values = new Map<string, number | null>()
  const seen = new Set<string>()

  const visit = (node: MapNode, inside: boolean): number | null => {
    const now = inside || (node.kind === 'component' && components.has(node.path))
    if (node.kind === 'file' && files.has(node.path)) seen.add(node.path)

    let value: number | null = null
    if (node.children.length === 0) value = now || files.has(node.path) ? 1 : before.has(node.path) ? 0 : null
    for (const child of node.children) {
      const held = visit(child, now)
      if (held !== null) value = Math.max(value ?? 0, held)
    }
    values.set(node.id, value)
    return value
  }

  visit(root, false)
  return { values, found: seen.size }
}
