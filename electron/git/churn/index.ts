import { git } from '../git'
import { sinceArgs } from '../log'
import { type FileStat, parseNumstat } from './numstat'
import { createPatchReader, type Hunk, type PatchCommit } from './patch'
import { streamLines } from './stream'

export type { Hunk } from './patch'

export type FileChange = FileStat & { created: boolean; deleted: boolean; hunks: Hunk[] | null }

export type ChangeSet = { sha: string; at: number; files: FileChange[] }

export type History = { commits: ChangeSet[]; working: ChangeSet | null }

const SAME = ['-M', '--no-color', '--no-ext-diff', '--no-textconv', '--relative']

const PATCH = ['-p', '-U0', '--inter-hunk-context=0']

const cached = new Map<string, { key: string; commits: Promise<ChangeSet[] | null> }>()

async function changesOf(root: string, command: string[]): Promise<ChangeSet[] | null> {
  const stats = await git(root, [...command, '--numstat', '-z', '--', '.'])
  if (!stats.ok) return null

  const reader = createPatchReader()
  const streamed = await streamLines(root, [...command, ...PATCH, '--', '.'], reader.line)
  const patches = new Map((streamed ? reader.commits() : []).map((commit): [string, PatchCommit] => [commit.sha, commit]))

  return parseNumstat(stats.value).map(({ sha, at, files }) => {
    const sections = patches.get(sha)?.sections
    const aligned = sections?.length === files.length ? sections : undefined
    return {
      sha,
      at,
      files: files.map((file, i) => {
        const section = aligned?.[i]
        return { ...file, created: section?.created ?? false, deleted: section?.deleted ?? false, hunks: section?.hunks ?? null }
      }),
    }
  })
}

export async function readHistory(root: string, since: number): Promise<History> {
  const head = await git(root, ['rev-parse', '--verify', 'HEAD'])
  if (!head.ok) return { commits: [], working: null }

  const key = `${head.value.trim()}:${since}`
  const known = cached.get(root)
  const entry = known?.key === key ? known : { key, commits: changesOf(root, ['log', '--first-parent', '-m', '--root', '--no-show-signature', ...sinceArgs(since), '--format=%x1e%H%x1f%ct', ...SAME]) }
  cached.set(root, entry)

  const [commits, working] = await Promise.all([entry.commits, changesOf(root, ['diff', 'HEAD', ...SAME])])
  if (commits === null && cached.get(root) === entry) cached.delete(root)
  return { commits: commits ?? [], working: working?.[0] ?? null }
}
