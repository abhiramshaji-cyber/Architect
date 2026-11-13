import type { MapNode } from '../../map/layout/nest'
import type { Step } from './steps'

export const EARLIER = 0.3

export type Lit = { values: Map<string, number | null>; found: number }

export function light(root: MapNode, steps: Step[], at: number): Lit {
  const step = steps[at]
  const files = new Set(step?.files ?? [])
  const components = new Set(step?.components ?? [])
  const earlier = steps.slice(0, Math.max(0, at))
  const before = new Set(earlier.flatMap((item) => item.files))
  const changed = new Set(earlier.flatMap((item) => item.components))
  const values = new Map<string, number | null>()
  const seen = new Set<string>()

  const visit = (node: MapNode, inside: boolean, once: boolean): number | null => {
    const now = inside || (node.kind === 'component' && components.has(node.path))
    const past = once || (node.kind === 'component' && changed.has(node.path))
    if (node.kind === 'file' && files.has(node.path)) seen.add(node.path)

    let value: number | null = null
    if (node.children.length === 0) value = now || files.has(node.path) ? 1 : past || before.has(node.path) ? EARLIER : null
    for (const child of node.children) {
      const held = visit(child, now, past)
      if (held !== null) value = Math.max(value ?? 0, held)
    }
    values.set(node.id, value)
    return value
  }

  visit(root, false, false)
  return { values, found: seen.size }
}
