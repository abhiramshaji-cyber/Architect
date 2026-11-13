import { plural } from '../../shared/text/plural'
import { git } from '../git/git'

export type Repo = { owner: string; name: string }

export type Linker = { link: (file: string, start: number, end: number) => string | null; why: (file: string) => string; drift: string | null } | { note: string }

const SCP = /^[^/@:]+@([^/:]+):(?!\/)(.+)$/

const GITHUB = new Set(['github.com', 'www.github.com'])

const paths = (out: string) => new Set(out.split('\0').filter(Boolean))

export function githubRepo(remote: string): Repo | null {
  const trimmed = remote.trim()
  const scp = SCP.exec(trimmed)
  let url: URL
  try {
    url = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : trimmed)
  } catch {
    return null
  }
  if (!GITHUB.has(url.hostname.toLowerCase())) return null
  const parts = url.pathname.split('/').filter(Boolean)
  const [owner, repo] = parts
  if (parts.length !== 2 || owner === undefined || repo === undefined) return null
  const name = repo.replace(/\.git$/i, '')
  return name === '' ? null : { owner, name }
}

export function permalink(repo: Repo, commit: string, file: string, start: number, end: number): string {
  const encoded = file.split('/').map(encodeURIComponent).join('/')
  const range = start === end ? `L${start}` : `L${start}-L${end}`
  return `https://github.com/${repo.owner}/${repo.name}/blob/${commit}/${encoded}#${range}`
}

function driftOf(sha: string, upstream: string, counts: string): string | null {
  const [ahead = 0, behind = 0] = counts.trim().split(/\s+/).map(Number)
  if (ahead === 0 && behind === 0) return null
  const gap = [ahead > 0 ? `${plural(ahead, 'commit')} ahead of` : '', behind > 0 ? `${plural(behind, 'commit')} behind` : ''].filter(Boolean).join(' and ')
  return `Note: the link points at local commit ${sha.slice(0, 7)}, which is ${gap} ${upstream}; that commit is on origin, so the link resolves.`
}

export async function linkerFor(root: string): Promise<Linker> {
  const [commit, remote, prefix, pushed, tracked, changed, upstream, counts] = await Promise.all([
    git(root, ['rev-parse', 'HEAD']),
    git(root, ['remote', 'get-url', 'origin']),
    git(root, ['rev-parse', '--show-prefix']),
    git(root, ['branch', '-r', '--contains', 'HEAD', '--list', 'origin/*']),
    git(root, ['ls-tree', '-r', '-z', '--name-only', '--full-tree', 'HEAD']),
    git(root, ['diff', '-z', '--name-only', 'HEAD']),
    git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
    git(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']),
  ])
  if (!commit.ok || !prefix.ok || !tracked.ok || !changed.ok) return { note: 'No permalink: this folder is not a git repository with a commit.' }
  if (!remote.ok) return { note: 'No permalink: the repository has no origin remote.' }
  const repo = githubRepo(remote.value)
  if (!repo) return { note: 'No permalink: the origin remote is not on github.com.' }
  if (!pushed.ok || pushed.value.trim() === '') return { note: 'No permalink: HEAD is not on any origin branch, so a link to it would 404. Push first.' }

  const sha = commit.value.trim()
  const base = prefix.value.trim()
  const [committed, edited] = [paths(tracked.value), paths(changed.value)]
  const linkable = (file: string) => committed.has(base + file) && !edited.has(base + file)
  return {
    drift: upstream.ok && counts.ok ? driftOf(sha, upstream.value.trim(), counts.value) : null,
    link: (file, start, end) => (linkable(file) ? permalink(repo, sha, base + file, start, end) : null),
    why: (file) => (committed.has(base + file) ? `No permalink: ${file} has uncommitted changes, so its lines at HEAD may differ.` : `No permalink: ${file} is not committed at HEAD.`),
  }
}
