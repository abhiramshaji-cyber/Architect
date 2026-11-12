const TOKEN = /[A-Z]+(?![a-z])\d*|[A-Z]?[a-z]+\d*|\d+/g

export type Named = { name: string } | { unnamed: string }

function tokensOf(name: string): string[] {
  const own = name.split('.').pop() ?? name
  if (own === 'default') return []
  return (own.match(TOKEN) ?? []).map((token) => token.toLowerCase())
}

function tally(tokens: string[], among?: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) if (!among || among.includes(token)) counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}

function leaders(counts: Map<string, number>): string[] {
  const top = Math.max(0, ...counts.values())
  return [...counts].filter(([, count]) => count === top).map(([token]) => token).sort()
}

export function jobName(exported: string[], members: string[]): Named {
  const leading = (names: string[]) => names.flatMap((name) => tokensOf(name).slice(0, 1))
  const first = tally(leading(exported))
  let tied = leaders(first)
  if (tied.length === 0) return { unnamed: 'no exported name has a word to name the job after' }

  for (const tokens of [leading(members), members.flatMap(tokensOf)]) {
    if (tied.length === 1) break
    tied = leaders(tally(tokens, tied))
  }
  if (tied.length === 1) return { name: tied[0] as string }
  return { unnamed: `the leading words of the exported names tie: ${tied.map((token) => `${token} x${first.get(token) ?? 0}`).join(', ')}` }
}
