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

export function treeOf(rows: FunctionRow[], edges: number[][], lifted = false): FunctionTree {
  const rank = rankOf(rows)
  const parent = new Array<number | null>(rows.length).fill(null)
  const seen = new Array<boolean>(rows.length).fill(false)

  const walk = (seeds: number[]) => {
    for (const seed of seeds) seen[seed] = true
    let frontier = seeds
    while (frontier.length > 0) {
      const next: number[] = []
      for (const from of frontier) {
        for (const to of [...(edges[from] ?? [])].sort(rank)) {
          if (to < 0 || to >= rows.length || seen[to]) continue
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
  walk(starts)

  const loose = all.filter((at) => !seen[at] && rows[at]?.fanIn === 0)
  walk(loose)
  const unreached = lifted ? [] : [...loose]
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
  return { starts: lifted ? [...starts, ...loose] : starts, groups: groupsOf(rows, starts), unreached, children, also }
}
