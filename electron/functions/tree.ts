import type { EntryGroup, FunctionRow, FunctionTree } from '../../shared/types'

export function rankOf(rows: FunctionRow[]): (a: number, b: number) => number {
  return (a, b) => {
    const x = rows[a]
    const y = rows[b]
    if (!x || !y) return a - b
    return (
      y.importance - x.importance ||
      y.lines - x.lines ||
      x.name.localeCompare(y.name) ||
      x.file.localeCompare(y.file) ||
      a - b
    )
  }
}

export function groupsOf(rows: FunctionRow[], starts: number[]): EntryGroup[] {
  const groups = new Map<string, EntryGroup>()
  for (const at of starts) {
    const entry = rows[at]?.entry
    if (!entry) continue
    const key = `${entry.reason}\0${entry.file}`
    const group = groups.get(key) ?? { file: entry.file, reason: entry.reason, members: [] }
    group.members.push(at)
    groups.set(key, group)
  }
  return [...groups.values()]
}

function signaturesOf(rows: FunctionRow[]): number[][] {
  const bodies = new Map<string, number[]>()
  rows.forEach((row, at) => {
    if (!row.overload) bodies.set(`${row.file}\0${row.name}`, [...(bodies.get(`${row.file}\0${row.name}`) ?? []), at])
  })
  const signatures = rows.map((): number[] => [])
  rows.forEach((row, at) => {
    if (!row.overload) return
    const after = (bodies.get(`${row.file}\0${row.name}`) ?? []).filter((to) => (rows[to]?.line ?? 0) > row.line)
    const body = after.sort((a, b) => (rows[a]?.line ?? 0) - (rows[b]?.line ?? 0))[0]
    if (body !== undefined) signatures[body]?.push(at)
  })
  return signatures
}

export function treeOf(rows: FunctionRow[], edges: number[][], lifted = false): FunctionTree {
  const rank = rankOf(rows)
  const parent = new Array<number | null>(rows.length).fill(null)
  const seen = new Array<boolean>(rows.length).fill(false)

  const signatures = signaturesOf(rows)
  const signed = new Set(signatures.flat())

  const walk = (seeds: number[], allow = (_: number) => true) => {
    for (const seed of seeds) seen[seed] = true
    let frontier = seeds
    while (frontier.length > 0) {
      const next: number[] = []
      for (const from of frontier) {
        for (const to of [...(edges[from] ?? []), ...(signatures[from] ?? [])].sort(rank)) {
          if (to < 0 || to >= rows.length || seen[to] || !allow(to)) continue
          seen[to] = true
          parent[to] = from
          next.push(to)
        }
      }
      frontier = next.sort(rank)
    }
  }

  const all = rows.map((_, at) => at).sort(rank)
  const starts = all.filter((at) => (rows[at]?.entry ?? null) !== null)
  const loose = all.filter((at) => (rows[at]?.entry ?? null) === null && rows[at]?.fanIn === 0 && !signed.has(at))
  walk(starts)
  const lifts = lifted ? [...loose] : []
  walk(lifts)
  for (const at of lifted ? all : []) {
    if (seen[at] || (rows[at]?.outsideCallers ?? 0) === 0) continue
    lifts.push(at)
    walk([at])
  }

  const tested = (at: number) => rows[at]?.untraced === 'test'
  const declared = (at: number) => rows[at]?.overload === true && !signed.has(at)
  const unknown = all.filter((at) => !seen[at] && !tested(at) && ((rows[at]?.untraced ?? null) !== null || declared(at)))
  walk(unknown)
  for (const at of all) {
    if (seen[at] || !tested(at)) continue
    unknown.push(at)
    walk([at], tested)
  }

  const unreached = loose.filter((at) => !seen[at])
  walk(unreached)
  for (const at of all) {
    if (seen[at]) continue
    unreached.push(at)
    walk([at])
  }
  unreached.sort(rank)

  const children = rows.map((): number[] => [])
  for (const at of all) {
    const up = parent[at]
    if (up !== null && up !== undefined) children[up]?.push(at)
  }

  const also = rows.map((row, at) => Math.max(0, row.fanIn - (parent[at] === null ? 0 : 1)))
  return { starts: [...starts, ...lifts], groups: groupsOf(rows, starts), unknown, unreached, children, also }
}
