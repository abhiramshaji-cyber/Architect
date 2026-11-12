import type { Commit, HistoryEntry } from '../../../../shared/types'

export type Step = {
  key: string
  at: number
  kind: 'commit' | 'code' | 'contract'
  files: string[]
  components: string[]
  title: string
  session?: string
}

const FILE = 'codefile:'

function idsOf(entry: HistoryEntry): string[] {
  return [...entry.added, ...entry.changed, ...entry.removed]
}

function fromCommit(commit: Commit): Step {
  return {
    key: `c:${commit.sha}`,
    at: commit.at,
    kind: 'commit',
    files: commit.files,
    components: [],
    title: commit.subject,
  }
}

function fromEntry(entry: HistoryEntry): Step {
  const ids = idsOf(entry)
  const files = entry.source === 'code' ? ids.filter((id) => id.startsWith(FILE)).map((id) => id.slice(FILE.length)) : []
  const components = entry.source === 'contract' ? [...new Set(ids.flatMap((id) => id.split('->')))] : []
  return {
    key: `h:${entry.id}`,
    at: entry.at,
    kind: entry.source,
    files: [...new Set(files)],
    components,
    title: '',
    ...(entry.session === undefined ? {} : { session: entry.session }),
  }
}

export function stepsOf(commits: Commit[], history: HistoryEntry[], since: number): Step[] {
  const made = [...[...commits].reverse().map(fromCommit), ...[...history].reverse().map(fromEntry)]
  return made
    .filter((step) => step.at >= since && (step.files.length > 0 || step.components.length > 0))
    .sort((a, b) => a.at - b.at)
}
