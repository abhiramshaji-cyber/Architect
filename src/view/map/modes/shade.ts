import { type Churn, changeKey } from '../../../../shared/recency'
import type { FunctionRow } from '../../../../shared/types'
import type { MapNode } from '../layout/nest'

export type ModeId = 'importance' | 'churn' | 'touched' | 'unreached'

export type Sessions = Map<string, { session: string; at: number }[]>

export type Facts = {
  rows: FunctionRow[]
  unreached: Set<number>
  churn: Churn | null
  sessions: Sessions
  recorded: number
}

export function busiestOf(counts: number[]): number {
  return counts.reduce((top, count) => Math.max(top, count), 0)
}

export function churnTop(facts: Facts): number {
  const churn = facts.churn
  if (!churn) return 0
  const files = Object.values(churn.files).map((file) => file.commits)
  return busiestOf([...facts.rows.map((row) => churnOf(row, churn)), ...files].filter(Number.isFinite))
}

export function churnOf(row: FunctionRow, churn: Churn): number {
  return churn.functions[changeKey(row.file, row.line, row.name)] ?? 0
}

export function leafValues(mode: ModeId, facts: Facts): (number | null)[] {
  const { rows, churn } = facts
  if (mode === 'importance') return rows.map((row) => (row.importance - 1) / 4)
  if (mode === 'unreached') return rows.map((_, at) => (facts.unreached.has(at) ? 1 : 0))
  if (mode === 'touched') return rows.map((row) => (facts.sessions.has(row.file) ? 1 : 0))
  if (!churn) return rows.map(() => null)
  const top = Math.log1p(churnTop(facts))
  return rows.map((row) => (top > 0 ? Math.log1p(churnOf(row, churn)) / top : 0))
}

export function shade(root: MapNode, mode: ModeId, facts: Facts): Map<string, number | null> {
  const leaves = leafValues(mode, facts)
  const values = new Map<string, number | null>()
  const churn = facts.churn
  const top = Math.log1p(churnTop(facts))

  const rest = (file: string): number | null => {
    if (mode === 'touched') return facts.sessions.has(file) ? 1 : 0
    if (mode !== 'churn' || !churn) return null
    return top > 0 ? Math.log1p(churn.files[file]?.commits ?? 0) / top : 0
  }

  const visit = (node: MapNode): number | null => {
    if (node.fn !== undefined || node.kind === 'rest') {
      const value = node.fn === undefined ? rest(node.path) : (leaves[node.fn] ?? null)
      values.set(node.id, value)
      return value
    }
    let sum = 0
    let weight = 0
    for (const child of node.children) {
      const value = visit(child)
      if (value === null) continue
      sum += value * child.weight
      weight += child.weight
    }
    const value = weight > 0 ? sum / weight : null
    values.set(node.id, value)
    return value
  }

  visit(root)
  return values
}
