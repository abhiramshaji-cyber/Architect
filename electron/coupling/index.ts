import type { CodeMap, Commit, Coupling, GitResult, HistoryEntry } from '../../shared/types'
import { commitsSince } from '../git/log'
import { askOf } from './ask'
import { linker } from './linked'
import { type Change, tally } from './pairs'
import { rankPairs } from './rank'

const DAY = 86_400_000

const FILE = 'codefile:'

function sessionsOf(history: HistoryEntry[], since: number): Map<string, Change & { at: number }> {
  const found = new Map<string, Change & { at: number }>()
  for (const entry of history) {
    if (entry.source !== 'code' || entry.session === undefined || entry.at < since) continue
    const files = [...entry.added, ...entry.changed, ...entry.removed].flatMap((id) => (id.startsWith(FILE) ? [id.slice(FILE.length)] : []))
    const known = found.get(entry.session)
    found.set(entry.session, { id: entry.session, files: [...(known?.files ?? []), ...files], at: Math.max(known?.at ?? 0, entry.at) })
  }
  return found
}

export function coupled(map: CodeMap, commits: Commit[], history: HistoryEntry[], raw: unknown, now: number): Coupling {
  const ask = askOf(raw)
  const since = Math.floor(now / DAY) * DAY - ask.days * DAY
  const known = new Set(map.folders.flatMap((folder) => folder.files.map((file) => file.path)))
  const kept = commits.filter((commit) => commit.at >= since && commit.files.length <= ask.maxFiles)
  const sessions = sessionsOf(history, since)

  const pairs = rankPairs(
    tally(kept.map((commit) => ({ id: commit.sha, files: commit.files })), known),
    tally([...sessions.values()], known),
    linker(map),
    ask,
  )

  const cited = new Set(pairs.flatMap((pair) => [...pair.commits.shared, ...pair.sessions.shared]))
  return {
    ask,
    skipped: commits.filter((commit) => commit.at >= since && commit.files.length > ask.maxFiles).length,
    historyFrom: history.reduce<number | null>((oldest, entry) => (oldest === null || entry.at < oldest ? entry.at : oldest), null),
    commits: Object.fromEntries(kept.filter((commit) => cited.has(commit.sha)).map(({ sha, short, at, subject }) => [sha, { short, at, subject }])),
    sessions: Object.fromEntries([...sessions.values()].filter((session) => cited.has(session.id)).map((session) => [session.id, session.at])),
    pairs,
  }
}

export async function couplingOf(root: string, map: CodeMap, history: HistoryEntry[], raw: unknown): Promise<GitResult<Coupling>> {
  const now = Date.now()
  const since = Math.floor(now / DAY) * DAY - askOf(raw).days * DAY
  const read = await commitsSince(root, since)
  return read.ok ? { ok: true, value: coupled(map, read.value, history, raw, now) } : read
}
