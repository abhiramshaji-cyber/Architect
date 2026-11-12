import type { EntryGroup, FunctionRow, FunctionTree } from '../../../../shared/types'
import { matches } from '../order'

export const PROJECT = 'project'
export const UNREACHED = 'unreached'

export type Outline = {
  kids: Map<string, string[]>
  up: Map<string, string>
  starts: Set<string>
  groups: Map<string, EntryGroup>
}

export type Shown = { ids: string[]; links: { from: string; to: string }[] }

export const idOf = (at: number) => `f${at}`

export const indexOf = (id: string) => (/^f\d+$/.test(id) ? Number(id.slice(1)) : -1)

export const groupIdOf = (group: EntryGroup) => `g:${group.reason}:${group.file}`

export function outlineOf(tree: FunctionTree): Outline {
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
  return { kids, up, starts: new Set(tree.starts.map(idOf)), groups }
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
