import type { EntryGroup, EntryReason, FunctionList, FunctionRow } from '../../../../shared/types'
import { matches } from '../order'
import { WIDE, bucketsOf, type Item, type Made } from './buckets'
import { sizesOf, talliesOf, type Tally } from './buckets/counts'

export const PROJECT = 'project'
export const UNREACHED = 'unreached'
export const UNREACHED_TITLE = 'Not reached from a starting point'

export const REASON: Record<EntryReason, string> = {
  mcpTool: 'MCP tool',
  ipcHandler: 'IPC handler',
  bridge: 'Preload bridge',
  cliCommand: 'CLI command',
  electronMain: 'Electron main',
  preload: 'Electron preload',
  renderer: 'Electron renderer',
  page: 'Page script',
  bin: 'package.json bin',
  main: 'package.json main',
  script: 'package.json script',
}

export type Outline = {
  kids: Map<string, string[]>
  up: Map<string, string>
  starts: Set<string>
  groups: Map<string, EntryGroup>
  buckets: Map<string, Made>
  tallies: Map<string, Tally>
}

export type Shape = Pick<FunctionList, 'tree' | 'rows' | 'calls' | 'owners'>

export type Shown = { ids: string[]; links: { from: string; to: string }[] }

export const idOf = (at: number) => `f${at}`

export const indexOf = (id: string) => (/^f\d+$/.test(id) ? Number(id.slice(1)) : -1)

export const groupIdOf = (group: EntryGroup) => `g:${group.reason}:${group.file}`

function bucketed(
  kids: Map<string, string[]>,
  adopt: (parent: string, children: string[]) => void,
  { rows, owners }: Shape,
  groups: Map<string, EntryGroup>,
): Map<string, Made> {
  const sizes = sizesOf(kids, PROJECT, (id) => (indexOf(id) >= 0 ? 1 : 0))
  const itemOf = (id: string): Item => {
    const size = sizes.get(id) ?? 0
    const row = rows[indexOf(id)]
    if (row) return { id, name: row.name, size, file: row.file, component: owners[row.file] }
    const group = groups.get(id)
    if (group) return { id, name: REASON[group.reason], size, file: group.file, component: owners[group.file] }
    return { id, name: id === UNREACHED ? UNREACHED_TITLE : id, size }
  }

  const made = new Map<string, Made>()
  for (const [parent, children] of [...kids]) {
    if (children.length <= WIDE) continue
    const split = bucketsOf(parent, children.map(itemOf))
    for (const [id, list] of split.kids) adopt(id, list)
    for (const [id, bucket] of split.made) made.set(id, bucket)
  }
  return made
}

export function outlineOf(shape: Shape): Outline {
  const { tree } = shape
  const kids = new Map<string, string[]>()
  const up = new Map<string, string>()
  const adopt = (parent: string, children: string[]) => {
    kids.set(parent, children)
    for (const child of children) up.set(child, parent)
  }

  const groups = new Map(tree.groups.map((group) => [groupIdOf(group), group]))
  const grouped = new Set(tree.groups.flatMap((group) => group.members))
  const loose = tree.starts.filter((at) => !grouped.has(at)).map(idOf)
  adopt(PROJECT, [...groups.keys(), ...loose, ...(tree.unreached.length > 0 ? [UNREACHED] : [])])
  for (const [id, group] of groups) adopt(id, group.members.map(idOf))
  if (tree.unreached.length > 0) adopt(UNREACHED, tree.unreached.map(idOf))
  tree.children.forEach((children, at) => {
    if (children.length > 0) adopt(idOf(at), children.map(idOf))
  })
  const starts = new Set(tree.starts.map(idOf))
  const buckets = bucketed(kids, adopt, shape, groups)
  const links = new Map(shape.rows.map((_, at) => [idOf(at), (shape.calls[at] ?? []).map(idOf)]))
  const tallies = talliesOf(kids, PROJECT, [...buckets.keys(), ...groups.keys(), UNREACHED], links, starts)
  return { kids, up, starts, groups, buckets, tallies }
}

export function lineageOf(outline: Outline, id: string | null): Set<string> {
  const line = new Set<string>()
  for (let at = id ?? undefined; at !== undefined && !line.has(at); at = outline.up.get(at)) line.add(at)
  return line
}

export function hitsOf(rows: FunctionRow[], query: string): Set<string> | null {
  const needle = query.trim().toLowerCase()
  if (needle === '') return null
  const hits = new Set<string>()
  rows.forEach((row, at) => {
    if (matches(row, needle)) hits.add(idOf(at))
  })
  return hits
}

export function forcedOf(outline: Outline, hits: Set<string> | null): Set<string> {
  const forced = new Set<string>()
  for (const hit of hits ?? []) {
    for (let at = outline.up.get(hit); at !== undefined && !forced.has(at); at = outline.up.get(at)) forced.add(at)
  }
  return forced
}

export function isOpen(outline: Outline, id: string, overrides: Map<string, boolean>, forced: Set<string>): boolean {
  const alone = id === UNREACHED && outline.kids.get(PROJECT)?.length === 1
  return overrides.get(id) ?? (forced.has(id) || id === PROJECT || alone || outline.starts.has(id))
}

export function toggledOf(
  outline: Outline,
  overrides: Map<string, boolean>,
  id: string,
  forced: Set<string>,
): Map<string, boolean> {
  const next = new Map(overrides).set(id, !isOpen(outline, id, overrides, forced))
  if (!next.get(id) || !outline.buckets.has(id)) return next
  for (const sibling of outline.kids.get(outline.up.get(id) ?? '') ?? []) {
    if (sibling !== id && outline.buckets.has(sibling)) next.set(sibling, false)
  }
  return next
}

export function shownOf(outline: Outline, open: (id: string) => boolean): Shown {
  const ids: string[] = []
  const links: Shown['links'] = []
  const stack = [PROJECT]
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    ids.push(id)
    if (!open(id)) continue
    const children = outline.kids.get(id) ?? []
    for (const child of children) links.push({ from: id, to: child })
    stack.push(...[...children].reverse())
  }
  return { ids, links }
}
