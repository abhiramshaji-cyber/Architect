import type { Change, GitResult } from '../../../shared/types'
import { pooled } from '../../../shared/pool'
import { git } from '../git'
import { parseBlame } from './parse'

export type Lines = Change[] | 'uncommitted'

type Seen = { head: string; files: Map<string, Promise<Lines | null>> }

const seen = new Map<string, Seen>()

const NONE: GitResult<string> = { ok: true, value: '' }

const listed = (out: GitResult<string>) => new Set(out.ok ? out.value.split('\0').filter(Boolean) : [])

async function blameOf(root: string, path: string): Promise<Lines | null> {
  const out = await git(root, ['blame', '--porcelain', '--', path])
  return out.ok ? parseBlame(out.value) : null
}

export async function blameFiles(root: string, paths: string[]): Promise<Map<string, Lines>> {
  const head = await git(root, ['rev-parse', '--verify', 'HEAD'])
  if (!head.ok && head.error.kind !== 'no-commits') return new Map()

  // list
  const [tree, edited, untracked] = await Promise.all([
    head.ok ? git(root, ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', '.']) : NONE,
    git(root, head.ok ? ['diff', 'HEAD', '--name-only', '-z', '--relative', '--', '.'] : ['ls-files', '-z', '--', '.']),
    git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.']),
  ])
  if (!tree.ok || !edited.ok || !untracked.ok) return new Map()
  const committed = listed(tree)
  const changed = new Set([...listed(edited), ...listed(untracked)])

  // cache
  const sha = head.ok ? head.value.trim() : ''
  const cached = seen.get(root)
  const files = cached?.head === sha ? cached.files : new Map<string, Promise<Lines | null>>()
  seen.set(root, { head: sha, files })

  const blamed = await pooled(paths, async (path): Promise<Lines | null> => {
    if (!committed.has(path)) return changed.has(path) ? 'uncommitted' : null
    if (changed.has(path)) return blameOf(root, path)
    const known = files.get(path) ?? blameOf(root, path)
    files.set(path, known)
    return known
  })
  return new Map(paths.flatMap((path, at) => (blamed[at] ? [[path, blamed[at]] as const] : [])))
}
