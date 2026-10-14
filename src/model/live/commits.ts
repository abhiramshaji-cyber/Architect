import type { Commit, HistoryEntry } from '../../../shared/types'

export type CommitGroup = { key: string; commit: Commit | null; at: number; entries: HistoryEntry[] }

const CONTRACT_FILE = 'architect.md'

export function pathsOf(entry: HistoryEntry): string[] {
  if (entry.source === 'contract') return [CONTRACT_FILE]
  const ids = [...entry.added, ...entry.changed, ...entry.removed]
  const paths = ids.map((id) => (id.startsWith('folder:') ? `${id.slice('folder:'.length)}/` : id.slice(id.indexOf(':') + 1)))
  return entry.file === undefined ? paths : [entry.file, ...paths]
}

function touches(commit: Commit, paths: string[]): boolean {
  return commit.files.some((file) => paths.some((p) => file === p || (p.endsWith('/') && file.startsWith(p))))
}

export function commitOf(entry: HistoryEntry, commits: Commit[]): Commit | null {
  const paths = pathsOf(entry)
  let found: Commit | null = null
  for (const commit of commits) {
    // git commit times are whole seconds, so a commit stamped s happened somewhere in [s, s + 1000)
    const after = commit.at + 999 >= entry.at
    if (after && touches(commit, paths) && (!found || commit.at <= found.at)) found = commit
  }
  return found
}

export function byCommit(entries: HistoryEntry[], commits: Commit[]): CommitGroup[] {
  const groups = new Map<string, CommitGroup>()
  for (const entry of entries) {
    const commit = commitOf(entry, commits)
    const key = commit?.sha ?? 'uncommitted'
    const group = groups.get(key)
    if (group) group.entries.push(entry)
    else groups.set(key, { key, commit, at: commit?.at ?? entry.at, entries: [entry] })
  }
  return [...groups.values()].sort((a, b) => Number(a.commit !== null) - Number(b.commit !== null) || b.at - a.at)
}
