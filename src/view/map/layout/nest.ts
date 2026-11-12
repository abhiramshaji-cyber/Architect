import type { FunctionRow, Ownership } from '../../../../shared/types'

export type Kind = 'root' | 'component' | 'top' | 'folder' | 'file' | 'function' | 'rest'

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

export type SizedFile = { path: string; lines?: number }

export function ownLines(rows: FunctionRow[]): number[] {
  const own = rows.map((row) => Math.max(0, row.lines))
  const byFile = new Map<string, number[]>()
  rows.forEach((row, at) => {
    const held = byFile.get(row.file)
    if (held) held.push(at)
    else byFile.set(row.file, [at])
  })

  for (const ats of byFile.values()) {
    const start = (at: number) => rows[at]?.line ?? 0
    const end = (at: number) => start(at) + (rows[at]?.lines ?? 0) - 1
    ats.sort((a, b) => start(a) - start(b) || end(b) - end(a) || a - b)
    const open: number[] = []
    for (const at of ats) {
      while (open.length > 0 && end(open[open.length - 1] as number) < start(at)) open.pop()
      const parent = open[open.length - 1]
      const inside = parent !== undefined && end(at) <= end(parent)
      if (inside) own[parent] = Math.max(0, (own[parent] ?? 0) - (rows[at]?.lines ?? 0))
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

export function nest(rows: FunctionRow[], files: SizedFile[], ownership: Ownership | null, project: string): MapNode {
  const grouping = grouper(ownership)
  const root: MapNode = { id: '', label: project, kind: 'root', path: '', weight: 0, children: [] }
  const own = ownLines(rows)
  const index = new Map<string, MapNode>()

  const fileOf = (path: string) => {
    const found = index.get(path)
    if (found) return found
    const group = grouping.of(path)
    const folder = folderOf(path)
    const top = branch(root, `g\0${group}`, group, grouping.kind, group)
    const dir = branch(top, `d\0${group}\0${folder}`, folder, 'folder', folder)
    const made = branch(dir, `f\0${group}\0${path}`, path.slice(path.lastIndexOf('/') + 1), 'file', path)
    index.set(path, made)
    return made
  }

  rows.forEach((row, at) => {
    const id = `n\0${row.file}\0${row.line}\0${row.name}\0${at}`
    fileOf(row.file).children.push({
      id,
      label: row.name,
      kind: 'function',
      path: row.file,
      weight: own[at] ?? 0,
      children: [],
      fn: at,
    })
  })

  for (const { path, lines } of files) {
    if (lines === undefined || !Number.isFinite(lines)) continue
    const file = fileOf(path)
    const inside = file.children.reduce((sum, child) => sum + child.weight, 0)
    const rest = Math.max(0, lines - inside)
    file.children.push({ id: `r\0${path}`, label: 'outside functions', kind: 'rest', path, weight: rest, children: [] })
  }

  settle(root)
  return root
}
