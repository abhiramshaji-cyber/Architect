import type { MapNode } from './layout/nest'
import { churnOf, type Facts } from './modes/shade'

export type Line = [string, string]

const KINDS: Record<MapNode['kind'], string> = {
  root: 'project',
  component: 'component',
  top: 'top level folder',
  folder: 'folder',
  file: 'file',
  function: 'function',
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

function functionsUnder(node: MapNode): number[] {
  if (node.fn !== undefined) return [node.fn]
  return node.children.flatMap(functionsUnder)
}

function filesUnder(node: MapNode): string[] {
  if (node.kind === 'file') return [node.path]
  return node.children.flatMap(filesUnder)
}

const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%')

function sessionLines(files: string[], facts: Facts): Line[] {
  const touches = files.flatMap((file) => facts.sessions.get(file) ?? [])
  if (touches.length === 0) return [['AI touched', 'no']]
  const sessions = new Set(touches.map((touch) => touch.session))
  const latest = Math.max(...touches.map((touch) => touch.at))
  return [
    ['AI touched', plural(sessions.size, 'session')],
    ['last session edit', new Date(latest).toLocaleString()],
  ]
}

function functionLines(at: number, node: MapNode, facts: Facts): Line[] {
  const row = facts.rows[at]
  if (!row) return []
  const lines: Line[] = [
    ['at', `${row.file}:${row.line}`],
    ['lines', node.weight === row.lines ? String(row.lines) : `${row.lines} (${node.weight} outside nested functions)`],
    ['importance', `${row.importance} of 5`],
    ['callers', String(row.fanIn)],
    ['callees', String(row.fanOut)],
    [
      'reached',
      row.entry
        ? `starting point, ${row.entry.reason} in ${row.entry.file}`
        : facts.unreached.has(at)
          ? 'unreached'
          : 'yes',
    ],
  ]
  if (facts.churn) lines.push(['churn', `${churnOf(row, facts.churn)} commits in ${facts.churn.days} days`])
  return [...lines, ...sessionLines([row.file], facts)]
}

function groupLines(node: MapNode, facts: Facts): Line[] {
  const ats = functionsUnder(node)
  const files = filesUnder(node)
  const unreached = ats.filter((at) => facts.unreached.has(at))
  const lines: Line[] = [
    ['lines', `${node.weight} in ${plural(ats.length, 'function')}`],
    ['files', String(files.length)],
    ['unreached', `${plural(unreached.length, 'function')}, ${share(unreached.length, ats.length)}`],
  ]
  const top = Math.max(0, ...ats.map((at) => facts.rows[at]?.importance ?? 0))
  if (ats.length > 0) lines.push(['top importance', `${top} of 5`])
  if (node.kind === 'file' && facts.churn) {
    const file = facts.churn.files[node.path]
    lines.push([
      'churn',
      file
        ? `${file.commits} commits, +${file.added} -${file.removed} in ${facts.churn.days} days`
        : `0 commits in ${facts.churn.days} days`,
    ])
  }
  return [...lines, ...sessionLines(files, facts)]
}

export function factsFor(node: MapNode, facts: Facts): { kind: string; title: string; lines: Line[] } {
  const title = node.kind !== 'function' && node.kind !== 'root' ? node.path : node.label
  const lines = node.fn !== undefined ? functionLines(node.fn, node, facts) : groupLines(node, facts)
  return { kind: KINDS[node.kind], title, lines }
}
