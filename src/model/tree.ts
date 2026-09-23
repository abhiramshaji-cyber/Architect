import type { TreeEntry } from '../../shared/types'

export type Listings = Record<string, TreeEntry[]>

export type TreeRow = {
  path: string
  name: string
  dir: boolean
  owners: string[]
  depth: number
  open: boolean
  pending: boolean
}

export type Slice = { rows: TreeRow[]; before: number; after: number }

export function childPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`
}

export function parentPath(at: string): string {
  const cut = at.lastIndexOf('/')
  return cut === -1 ? '' : at.slice(0, cut)
}

export function rows(listings: Listings, open: ReadonlySet<string>, dir = '', depth = 0): TreeRow[] {
  const here = listings[dir]
  if (!here) return []

  return here.flatMap((entry) => {
    const at = childPath(dir, entry.name)
    const expanded = entry.dir && open.has(at)
    const children = expanded ? listings[at] : undefined
    const row: TreeRow = {
      path: at,
      name: entry.name,
      dir: entry.dir,
      owners: entry.owners,
      depth,
      open: expanded,
      pending: expanded && children === undefined,
    }
    return expanded && children ? [row, ...rows(listings, open, at, depth + 1)] : [row]
  })
}

export function slice(all: TreeRow[], scrollTop: number, height: number, rowHeight: number, overscan = 12): Slice {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const span = Math.ceil(height / rowHeight) + overscan * 2
  const last = Math.min(all.length, first + span)
  return { rows: all.slice(first, last), before: first * rowHeight, after: (all.length - last) * rowHeight }
}

export function step(all: TreeRow[], current: string | null, delta: number): string | null {
  if (all.length === 0) return null
  const at = all.findIndex((row) => row.path === current)
  const next = at === -1 ? (delta > 0 ? 0 : all.length - 1) : at + delta
  return all[Math.min(all.length - 1, Math.max(0, next))]?.path ?? null
}

export function hue(id: string): number {
  let acc = 0
  for (const ch of id) acc = (acc * 31 + ch.codePointAt(0)!) % 360
  return acc
}
