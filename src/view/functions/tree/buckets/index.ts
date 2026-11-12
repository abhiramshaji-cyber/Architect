export const WIDE = 12

export type BucketKind = 'component' | 'folder' | 'file' | 'names'

export type Item = { id: string; name: string; size: number; file?: string; component?: string }

export type Made = { kind: BucketKind; label: string }

export type Split = { kids: Map<string, string[]>; made: Map<string, Made> }

type Part = Made & { key: string; members: Item[] }

const KINDS: BucketKind[] = ['component', 'folder', 'names']

const NO_COMPONENT = 'No component'

const byName = (a: Item, b: Item) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

const bySize = (a: Part, b: Part) =>
  b.members.reduce((sum, item) => sum + item.size, 0) - a.members.reduce((sum, item) => sum + item.size, 0) ||
  a.label.localeCompare(b.label)

function sharedDir(files: string[]): string[] {
  const dirs = files.map((file) => file.split('/').slice(0, -1))
  const first = dirs[0] ?? []
  let depth = first.length
  for (const dir of dirs) {
    let at = 0
    while (at < depth && dir[at] === first[at]) at++
    depth = at
  }
  return first.slice(0, depth)
}

function keyed(items: Item[], keyOf: (item: Item) => Omit<Part, 'members'> | null): { parts: Part[]; loose: Item[] } {
  const parts = new Map<string, Part>()
  const loose: Item[] = []
  for (const item of items) {
    const made = keyOf(item)
    if (!made) {
      loose.push(item)
      continue
    }
    const part = parts.get(made.key) ?? { ...made, members: [] }
    part.members.push(item)
    parts.set(made.key, part)
  }
  return { parts: [...parts.values()].sort(bySize), loose }
}

function namesOf(items: Item[]): Part[] {
  const sorted = [...items].sort(byName)
  const count = Math.min(WIDE, Math.ceil(sorted.length / WIDE))
  const size = Math.ceil(sorted.length / count)
  return Array.from({ length: count }, (_, at) => {
    const members = sorted.slice(at * size, (at + 1) * size)
    const first = members[0]?.name ?? ''
    const last = members[members.length - 1]?.name ?? ''
    return { kind: 'names', key: String(at), label: first === last ? first : `${first} … ${last}`, members }
  })
}

function partsOf(kind: BucketKind, items: Item[]): { parts: Part[]; loose: Item[] } {
  if (kind === 'names') return { parts: namesOf(items), loose: [] }
  if (kind === 'component') {
    if (!items.some((item) => item.component !== undefined)) return { parts: [], loose: items }
    return keyed(items, (item) => {
      if (item.component !== undefined) return { kind, key: `=${item.component}`, label: item.component }
      return item.file === undefined ? null : { kind, key: '', label: NO_COMPONENT }
    })
  }
  const prefix = sharedDir(items.flatMap((item) => (item.file === undefined ? [] : [item.file])))
  return keyed(items, (item) => {
    if (item.file === undefined) return null
    const path = item.file.split('/')
    const deeper = path.length > prefix.length + 1
    const label = path.slice(0, prefix.length + 1).join('/')
    return deeper ? { kind: 'folder', key: `${label}/`, label: `${label}/` } : { kind: 'file', key: label, label }
  })
}

export function bucketsOf(parent: string, items: Item[]): Split {
  const kids = new Map<string, string[]>()
  const made = new Map<string, Made>()

  const wrap = (at: string, part: Part): Item => {
    const [only] = part.members
    if (only && part.members.length === 1) return only
    const id = `b:${at}>${part.kind}:${part.key}`
    made.set(id, { kind: part.kind, label: part.label })
    place(id, part.members, KINDS)
    return { id, name: part.label, size: part.members.reduce((sum, item) => sum + item.size, 0) }
  }

  const place = (at: string, list: Item[], kinds: BucketKind[]) => {
    if (list.length <= WIDE) {
      kids.set(at, list.map((item) => item.id))
      return
    }
    for (const kind of kinds) {
      const { parts, loose } = partsOf(kind, list)
      if (parts.length < 2 || parts.length + loose.length >= list.length) continue
      place(at, [...parts.map((part) => wrap(at, part)), ...loose], ['names'])
      return
    }
  }

  place(parent, items, KINDS)
  return { kids, made }
}
