import type { StyleFile } from '../../../../shared/types'
import type { MapNode } from '../layout/nest'

export function styleShade(root: MapNode, style: Map<string, StyleFile['failing']> | null): Map<string, number | null> {
  const values = new Map<string, number | null>()

  const visit = (node: MapNode, inherited: number | null): [number, number] => {
    if (node.kind === 'file') {
      const failing = style?.get(node.path)
      const value = failing === undefined ? null : failing.length > 0 ? 1 : 0
      values.set(node.id, value)
      for (const child of node.children) visit(child, value)
      return value === null ? [0, 0] : [value, 1]
    }
    if (node.kind === 'function' || node.kind === 'rest') {
      values.set(node.id, inherited)
      return [0, 0]
    }
    let failed = 0
    let total = 0
    for (const child of node.children) {
      const [f, t] = visit(child, null)
      failed += f
      total += t
    }
    values.set(node.id, total > 0 ? failed / total : null)
    return [failed, total]
  }

  visit(root, null)
  return values
}
