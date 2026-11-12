import { topsOf } from '../../../shared/folders'
import type { CodeMap, Component, FunctionRow } from '../../../shared/types'
import { indexOf, type EntryFiles } from '../../functions'
import { within } from '../../functions/scope'

const MAX_FUNCTIONS = 300

export type Fn = { ref: string; row: FunctionRow }

export type Evidence = {
  functions: Fn[]
  calls: [number, number][]
  files: string[]
  indexed: Set<string>
  tops: string[]
}

function shownOf(rows: FunctionRow[]): number[] {
  const all = rows.map((_, at) => at)
  if (rows.length <= MAX_FUNCTIONS) return all
  const rank = (at: number) => rows[at] as FunctionRow
  return all
    .sort((a, b) => rank(b).importance - rank(a).importance || rank(b).fanIn - rank(a).fanIn || a - b)
    .slice(0, MAX_FUNCTIONS)
    .sort((a, b) => a - b)
}

export function evidence(map: CodeMap, scope = '', declared: EntryFiles = new Map()): Evidence {
  const { rows, calls } = indexOf(map, declared, scope)
  const shown = shownOf(rows)
  const local = new Map(shown.map((at, i) => [at, i]))

  const functions = shown.map((at, i) => ({
    ref: `f${i + 1}`,
    row: rows[at] as FunctionRow,
  }))
  const pairs = shown.flatMap((at, i) =>
    (calls[at] ?? []).flatMap((to) => {
      const callee = local.get(to)
      return callee === undefined ? [] : [[i, callee] as [number, number]]
    }),
  )

  const files = [...new Set(map.folders.flatMap((folder) => folder.files.map((file) => file.path)))]
    .filter((file) => within(file, scope))
    .sort()

  return {
    functions,
    calls: pairs,
    files,
    indexed: new Set(rows.map((row) => row.file)),
    tops: topsOf(files, scope),
  }
}

export function skeleton(map: CodeMap): Component[] {
  const files = map.folders.flatMap((folder) => folder.files.map((file) => file.path))
  const groups = new Map<string, string[]>()
  for (const top of topsOf(files)) {
    const id = top.replaceAll('->', '-').replace(/\s+/g, '-')
    groups.set(id, [...(groups.get(id) ?? []), top])
  }

  return [...groups].map(([id, dirs]) => ({
    id,
    purpose: `Code under ${dirs.join(', ')}.`,
    owns: dirs.map((dir) => `${dir}/**`),
  }))
}
