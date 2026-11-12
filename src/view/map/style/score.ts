import type { CheckedRule, StyleFile } from '../../../../shared/types'
import type { MapNode } from '../layout/nest'

export const RULES: CheckedRule[] = ['lines', 'files', 'names', 'jobs']

export type Score = {
  files: number
  passing: number
  percent: number
  rules: Record<CheckedRule, number>
  failing: StyleFile[]
}

export function scoreOf(node: MapNode, style: Map<string, StyleFile['failing']>): Score {
  const files: StyleFile[] = []
  const visit = (at: MapNode) => {
    const failing = at.kind === 'file' ? style.get(at.path) : undefined
    if (failing) files.push({ path: at.path, failing })
    if (at.kind !== 'file') at.children.forEach(visit)
  }
  visit(node)

  const rules = Object.fromEntries(
    RULES.map((rule) => [rule, files.filter((file) => !file.failing.some((failure) => failure.rule === rule)).length]),
  ) as Record<CheckedRule, number>
  const failing = files.filter((file) => file.failing.length > 0).sort((a, b) => a.path.localeCompare(b.path))
  const passing = files.length - failing.length
  const percent = files.length > 0 ? Math.floor((passing / files.length) * 100) : 100
  return { files: files.length, passing, percent, rules, failing }
}
