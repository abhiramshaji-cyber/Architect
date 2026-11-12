import type { FunctionRow, Ownership } from '../../../../shared/types'

export type Kind = 'root' | 'component' | 'top' | 'folder' | 'file' | 'function'

export type Grouping = { kind: 'component' | 'top'; of: (file: string) => string }

export type MapNode = {
  id: string
  label: string
  kind: Kind
  path: string
  weight: number
  children: MapNode[]
  fn?: number
}

export const UNOWNED = 'unowned'

export function folderOf(file: string): string {
  const cut = file.lastIndexOf('/')
  return cut < 0 ? '.' : file.slice(0, cut)
}

export function grouper(ownership: Ownership | null): Grouping {
  if (!ownership) return { kind: 'top', of: (file) => (file.includes('/') ? file.slice(0, file.indexOf('/')) : '.') }
  const owners = new Map<string, string>()
  for (const { path, owner } of ownership.owned) owners.set(path, owner)
  for (const { path, owners: many } of ownership.multi) owners.set(path, many.join(' + '))
  return { kind: 'component', of: (file) => owners.get(file) ?? UNOWNED }
}

export function ownLines(rows: FunctionRow[]): number[] {
  const own = rows.map((row) => Math.max(0, row.lines))
  const byFile = new Map<string, number[]>()
  rows.forEach((row, at) => byFile.set(row.file, [...(byFile.get(row.file) ?? []), at]))

  for (const ats of byFile.values()) {
    const end = (at: number) => (rows[at]?.line ?? 0) + (rows[at]?.lines ?? 0) - 1
    ats.sort((a, b) => (rows[a]?.line ?? 0) - (rows[b]?.line ?? 0) || end(b) - end(a) || a - b)
    const open: number[] = []
    for (const at of ats) {
      while (open.length > 0 && end(open[open.length - 1] as number) < (rows[at]?.line ?? 0)) open.pop()
      const parent = open[open.length - 1]
      if (parent !== undefined && end(at) <= end(parent))
        own[parent] = Math.max(0, (own[parent] ?? 0) - (rows[at]?.lines ?? 0))
      open.push(at)
    }
  }
  return own
}

function branch(parent: MapNode, id: string, label: string, kind: Kind, path: string): MapNode {
  let found = parent.children.find((child) => child.id === id)
  if (!found) {
    found = { id, label, kind, path, weight: 0, children: [] }
    parent.children.push(found)
  }
  return found
}

function settle(node: MapNode): number {
  if (node.children.length > 0) {
    node.children = node.children.filter((child) => settle(child) > 0)
    node.children.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
    node.weight = node.children.reduce((sum, child) => sum + child.weight, 0)
  }
  return node.weight
}

export function nest(rows: FunctionRow[], ownership: Ownership | null, project: string): MapNode {
  const grouping = grouper(ownership)
  const root: MapNode = {
    id: '',
    label: project,
    kind: 'root',
    path: '',
    weight: 0,
    children: [],
  }
  const own = ownLines(rows)
  const index = new Map<string, MapNode>()

  rows.forEach((row, at) => {
    const group = grouping.of(row.file)
    const folder = folderOf(row.file)
    const fileId = `${group}\0${row.file}`
    let file = index.get(fileId)
    if (!file) {
      const top = branch(root, `g\0${group}`, group, grouping.kind, group)
      const dir = branch(top, `d\0${group}\0${folder}`, folder, 'folder', folder)
      file = branch(dir, `f\0${fileId}`, row.file.slice(row.file.lastIndexOf('/') + 1), 'file', row.file)
      index.set(fileId, file)
    }
    file.children.push({
      id: `n\0${row.file}\0${row.line}\0${row.name}\0${at}`,
      label: row.name,
      kind: 'function',
      path: row.file,
      weight: own[at] ?? 0,
      children: [],
      fn: at,
    })
  })

  settle(root)
  return root
}
