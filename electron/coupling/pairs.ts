export type Change = { id: string; files: string[] }

export type Tally = { counts: Map<string, number>; shared: Map<string, string[]> }

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`
}

export function tally(changes: Change[], known: Set<string>): Tally {
  const counts = new Map<string, number>()
  const shared = new Map<string, string[]>()
  for (const change of changes) {
    const files = [...new Set(change.files)].filter((file) => known.has(file)).sort()
    for (const file of files) counts.set(file, (counts.get(file) ?? 0) + 1)
    files.forEach((a, at) => {
      for (const b of files.slice(at + 1)) {
        const key = pairKey(a, b)
        const found = shared.get(key)
        if (found) found.push(change.id)
        else shared.set(key, [change.id])
      }
    })
  }
  return { counts, shared }
}
