import { type Churn, changeKey } from '../../../../shared/recency'
import type { FunctionRow, StyleFile } from '../../../../shared/types'
import type { MapNode } from '../layout/nest'
import { styleShade } from './style'

export type ModeId = 'importance' | 'churn' | 'touched' | 'unreached' | 'style'

export type Sessions = Map<string, { session: string; at: number }[]>

export type Facts = {
  rows: FunctionRow[]
  unreached: Set<number>
  unknown: Set<number>
  churn: Churn | null
  sessions: Sessions
  recorded: number
  style: Map<string, StyleFile['failing']> | null
}

export function busiestOf(counts: number[]): number {
  return counts.reduce((top, count) => Math.max(top, count), 0)
}

export function churnTop(root: MapNode, facts: Facts): number {
  const churn = facts.churn
  if (!churn) return 0
  const counts: number[] = []
  const visit = (node: MapNode) => {
    const row = node.fn === undefined ? undefined : facts.rows[node.fn]
    if (row) counts.push(churnOf(row, churn))
    if (node.kind === 'rest') counts.push(churn.files[node.path]?.commits ?? 0)
    node.children.forEach(visit)
  }
  visit(root)
  return busiestOf(counts.filter(Number.isFinite))
}

export function churnOf(row: FunctionRow, churn: Churn): number {
  return churn.functions[changeKey(row.file, row.line, row.name)] ?? 0
}

export function leafValues(mode: ModeId, facts: Facts, busiest: number): (number | null)[] {
  const { rows, churn } = facts
  if (mode === 'importance') return rows.map((row) => (row.importance - 1) / 4)
  if (mode === 'unreached') return rows.map((_, at) => (facts.unreached.has(at) ? 1 : 0))
  if (mode === 'touched') return rows.map((row) => (facts.sessions.has(row.file) ? 1 : 0))
  if (mode === 'style') return rows.map(() => null)
  if (!churn) return rows.map(() => null)
  const top = Math.log1p(busiest)
  return rows.map((row) => (top > 0 ? Math.log1p(churnOf(row, churn)) / top : 0))
}

export function shade(root: MapNode, mode: ModeId, facts: Facts): Map<string, number | null> {
  if (mode === 'style') return styleShade(root, facts.style)
  const busiest = mode === 'churn' ? churnTop(root, facts) : 0
  const leaves = leafValues(mode, facts, busiest)
  const values = new Map<string, number | null>()
  const churn = facts.churn
  const top = Math.log1p(busiest)

  const rest = (file: string): number | null => {
    if (mode === 'touched') return facts.sessions.has(file) ? 1 : 0
    if (mode !== 'churn' || !churn) return null
    return top > 0 ? Math.min(1, Math.log1p(churn.files[file]?.commits ?? 0) / top) : 0
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
