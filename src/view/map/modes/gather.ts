import type { Churn } from '../../../../shared/recency'
import type { FunctionList, FunctionTree, HistoryEntry } from '../../../../shared/types'
import type { Facts, Sessions } from './shade'

export function unreachedOf(tree: FunctionTree): Set<number> {
  const found = new Set<number>()
  const stack = [...tree.unreached]
  while (stack.length > 0) {
    const at = stack.pop() as number
    if (found.has(at)) continue
    found.add(at)
    stack.push(...(tree.children[at] ?? []))
  }
  return found
}

export function sessionsOf(history: HistoryEntry[]): Sessions {
  const found: Sessions = new Map()
  for (const entry of history) {
    if (entry.source !== 'code' || entry.session === undefined) continue
    for (const id of [...entry.added, ...entry.changed]) {
      if (!id.startsWith('codefile:')) continue
      const file = id.slice('codefile:'.length)
      const held = found.get(file) ?? []
      if (!held.some((touch) => touch.session === entry.session && touch.at === entry.at))
        held.push({ session: entry.session, at: entry.at })
      found.set(
        file,
        held.sort((a, b) => b.at - a.at),
      )
    }
  }
  return found
}

export function gather(list: FunctionList, churn: Churn | null, history: HistoryEntry[]): Facts {
  return {
    rows: list.rows,
    unreached: unreachedOf(list.tree),
    churn,
    sessions: sessionsOf(history),
    recorded: history.filter((entry) => entry.source === 'code').length,
  }
}
