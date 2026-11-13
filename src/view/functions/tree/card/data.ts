import type { FunctionList, FunctionRow, Untraced } from '../../../../../shared/types'
import { plural } from '../../Mark'
import type { Tally } from '../buckets/counts'
import { PROJECT, REASON, UNKNOWN, UNKNOWN_TITLE, UNREACHED, UNREACHED_TITLE, idOf, indexOf, lineageOf, type Outline } from '../outline'

const UNTRACED: Record<Untraced, string> = {
  value: 'used as a value',
  load: 'called from code outside any listed function',
  export: 'exported by a package entry not mapped to source',
  orphan: 'no file outside tests imports its file',
  computed: 'its package loads modules by a computed path',
  unparsed: 'its package has .vue, .svelte, .astro or .mdx files the scan does not parse',
  test: 'in a test file',
}

const countsOf = (tally: Tally | undefined) =>
  `${plural(tally?.functions ?? 0, 'function')} · ${plural(tally?.starts ?? 0, 'starting point')}`

function labelOf(outline: Outline, id: string, rows: FunctionList['rows'], project: string) {
  const tally = outline.tallies.get(id)
  const bucket = outline.buckets.get(id)
  if (bucket)
    return {
      title: bucket.label,
      tag: bucket.kind,
      notes: [
        countsOf(tally),
        `${plural(tally?.callsIn ?? 0, 'call')} in · ${(tally?.callsOut ?? 0).toLocaleString()} out`,
      ],
    }
  const entry = outline.groups.get(id)
  if (entry) return { title: REASON[entry.reason], notes: [entry.file, countsOf(tally)] }
  if (id === PROJECT) return { title: project, notes: [plural(rows.length, 'function')] }
  if (id === UNREACHED) return { title: UNREACHED_TITLE, notes: [plural(tally?.functions ?? 0, 'function')] }
  if (id === UNKNOWN) return { title: UNKNOWN_TITLE, notes: [plural(tally?.functions ?? 0, 'function'), 'callers not traced to a starting point'] }
  return { title: rows[indexOf(id)]?.name ?? id, notes: [] }
}

export function elsewhereOf(outline: Outline, { calls }: Pick<FunctionList, 'calls'>, at: number): number[] {
  const here = idOf(at)
  return [...new Set(calls[at] ?? [])].filter((to) => to !== at && outline.up.has(idOf(to)) && !underOf(outline, idOf(to), here))
}

function underOf(outline: Outline, id: string, parent: string): boolean {
  for (let up = outline.up.get(id); up !== undefined; up = outline.up.get(up)) {
    if (up === parent) return true
    if (indexOf(up) >= 0) return false
  }
  return false
}

const callersOf = (row: FunctionList['rows'][number]) =>
  `${plural(row.fanIn, 'caller')}${row.outsideCallers ? ` +${row.outsideCallers.toLocaleString()} outside` : ''}`

export function reachOf(outline: Outline, id: string, row: FunctionRow): string[] {
  const line = lineageOf(outline, id)
  const callers = row.fanIn === 0 ? 'no callers' : plural(row.fanIn, 'caller')
  if (line.has(UNREACHED)) return [`${row.fanIn === 0 ? callers : `${callers}, none reached`}`]
  if (!line.has(UNKNOWN)) return []
  if (row.twin && indexOf(outline.up.get(id) ?? '') < 0) return ['declaration without a body']
  return [`${row.untraced ? UNTRACED[row.untraced] : `${callers}, reach unknown`}`]
}

export function cardOf(outline: Outline, id: string, list: FunctionList, project: string) {
  const at = indexOf(id)
  const row = list.rows[at]
  const functions = id === PROJECT ? list.rows.length : (outline.tallies.get(id)?.functions ?? 0)
  const label = labelOf(outline, id, list.rows, project)
  return {
    ...label,
    notes: row ? reachOf(outline, id, row) : label.notes,
    pill: row ? callersOf(row) : plural(functions, 'function'),
    row: row ?? null,
    at,
    count: outline.kids.get(id)?.length ?? 0,
    also: list.tree.also[at] ?? 0,
    elsewhere: at >= 0 ? elsewhereOf(outline, list, at).length : 0,
  }
}
