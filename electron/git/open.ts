import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { git, parseWorktrees, succeeds } from './git'
import type { GitResult, OpenPlan, OpenRisk, OpenedBranch } from '../../shared/types'

export const GITHUB_DIR = path.join(os.homedir(), 'Documents', 'GitHub')

const SAMPLE = 50

const MARKERS: [string, string][] = [
  ['MERGE_HEAD', 'merge in progress'],
  ['CHERRY_PICK_HEAD', 'cherry-pick in progress'],
  ['REVERT_HEAD', 'revert in progress'],
  ['BISECT_LOG', 'bisect in progress'],
]

function rows(stdout: string): string[] {
  return stdout.split('\n').filter((line) => line.trim() !== '')
}

async function value(root: string, args: string[]): Promise<string | null> {
  const out = await git(root, args)
  const found = out.ok ? out.value.trim() : ''
  return found === '' ? null : found
}

async function isDir(target: string): Promise<boolean> {
  return fs.stat(target).then(
    (stat) => stat.isDirectory(),
    () => false,
  )
}

async function exists(target: string): Promise<boolean> {
  return fs.stat(target).then(
    () => true,
    () => false,
  )
}

export function repoKey(url: string): string | null {
  const cleaned = url.trim().toLowerCase().replace(/\.git$/, '')
  const found = /([^/:]+)\/([^/]+)$/.exec(cleaned)
  return found ? `${found[1]}/${found[2]}` : null
}

export function slug(branch: string): string {
  return branch.replace(/[/\\#\s]/g, '-')
}

export function worktreePath(basePath: string, branch: string, pr?: number): string {
  return pr === undefined ? `${basePath}-${slug(branch)}` : `${basePath}-pr-${pr}`
}

function badArgument(value: string): boolean {
  return value === '' || value.startsWith('-') || value.includes('\0')
}

function splitRepo(repo: string): [string, string] | null {
  const parts = repo.split('/')
  const [owner, name] = parts
  if (parts.length !== 2 || !owner || !name || badArgument(owner) || badArgument(name)) return null
  return [owner, name]
}

async function remoteFor(root: string, repo: string): Promise<string | null> {
  const listed = await git(root, ['remote'])
  if (!listed.ok) return null

  const want = repo.toLowerCase().replace(/\.git$/, '')
  for (const remote of rows(listed.value).map((line) => line.trim())) {
    const url = await value(root, ['remote', 'get-url', remote])
    if (url && repoKey(url) === want) return remote
  }

  return null
}

async function serves(dir: string, repo: string): Promise<boolean> {
  const origin = await value(dir, ['remote', 'get-url', 'origin'])
  if (!origin) return (await remoteFor(dir, repo)) !== null

  return repoKey(origin) === repo.toLowerCase().replace(/\.git$/, '')
}

export async function clonePath(dir: string, repo: string): Promise<string | null> {
  const split = splitRepo(repo)
  if (!split) return null

  const [owner, name] = split
  for (const candidate of [path.join(dir, name), path.join(dir, `${owner}-${name}`)]) {
    if (!(await isDir(candidate)) || (await serves(candidate, repo))) return candidate
  }

  return null
}

async function listWorktrees(basePath: string) {
  const out = await git(basePath, ['worktree', 'list', '--porcelain'])
  return out.ok ? parseWorktrees(out.value) : []
}

async function checkoutOf(basePath: string, branch: string): Promise<string | null> {
  return (await listWorktrees(basePath)).find((entry) => entry.branch === branch)?.path ?? null
}

async function upstream(target: string, branch: string, repo: string): Promise<{ remote: string; tracking: string }> {
  const fallback = (await remoteFor(target, repo)) ?? 'origin'
  const remote = await value(target, ['config', '--get', `branch.${branch}.remote`])
  const tracking = await value(target, ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`])

  return { remote: remote ?? fallback, tracking: tracking ?? `${fallback}/${branch}` }
}

export async function risk(target: string, branch: string, repo: string): Promise<OpenRisk> {
  const { tracking } = await upstream(target, branch, repo)
  const state = await git(target, ['status', '--short'])
  const log = await git(target, ['log', '--oneline', `${tracking}..HEAD`])

  const dirtyFiles = state.ok ? rows(state.value) : []
  const unpushedCommits = log.ok ? rows(log.value) : []

  return {
    tracking,
    dirty: dirtyFiles.length,
    unpushed: unpushedCommits.length,
    dirtyFiles: dirtyFiles.slice(0, SAMPLE),
    unpushedCommits: unpushedCommits.slice(0, SAMPLE),
  }
}

export async function plan(dir: string, repo: string, branch: string, pr?: number): Promise<GitResult<OpenPlan>> {
  if (!splitRepo(repo)) return { ok: false, error: { kind: 'bad-argument', value: repo } }
  if (badArgument(branch)) return { ok: false, error: { kind: 'bad-argument', value: branch } }

  const basePath = await clonePath(dir, repo)
  if (!basePath) return { ok: false, error: { kind: 'clone-dirs-taken', repo } }

  const target = worktreePath(basePath, branch, pr)
  if (!(await isDir(basePath))) return { ok: true, value: { kind: 'clone', basePath, worktreePath: target } }

  const held = (await checkoutOf(basePath, branch)) ?? ((await isDir(target)) ? target : null)
  if (!held) return { ok: true, value: { kind: 'fresh', basePath, worktreePath: target } }

  return { ok: true, value: { kind: 'existing', basePath, worktreePath: target, existing: held, risk: await risk(held, branch, repo) } }
}

export async function create(
  basePath: string,
  target: string,
  branch: string,
  repo: string,
  pr?: number,
): Promise<GitResult<OpenedBranch>> {
  if (badArgument(target)) return { ok: false, error: { kind: 'bad-argument', value: target } }
  if (badArgument(branch)) return { ok: false, error: { kind: 'bad-argument', value: branch } }

  const held = await checkoutOf(basePath, branch)
  if (held) return keep(held, branch, repo)

  const remote = (await remoteFor(basePath, repo)) ?? 'origin'

  const start = pr === undefined ? `${remote}/${branch}` : 'FETCH_HEAD'
  const ref = pr === undefined ? branch : `refs/pull/${pr}/head`
  const fetched = await git(basePath, ['fetch', remote, ref])

  if (fetched.ok && (await succeeds(basePath, ['rev-parse', '--verify', '--quiet', start]))) {
    const added = await git(basePath, ['worktree', 'add', '-B', branch, target, start])
    return added.ok ? { ok: true, value: { path: target, pulled: true, warning: null } } : added
  }

  const local = await git(basePath, ['worktree', 'add', target, branch])
  if (!local.ok) return local

  return { ok: true, value: { path: target, pulled: false, warning: `Opened ${branch} from the local ref: ${remote} had nothing to fetch` } }
}

async function gitDir(target: string): Promise<string | null> {
  return value(target, ['rev-parse', '--absolute-git-dir'])
}

async function rebasing(target: string): Promise<boolean> {
  const dir = await gitDir(target)
  if (!dir) return false

  for (const name of ['rebase-merge', 'rebase-apply']) {
    if (await isDir(path.join(dir, name))) return true
  }

  return false
}

async function blocker(target: string, branch: string): Promise<string | null> {
  if (await rebasing(target)) return 'rebase in progress'

  const dir = await gitDir(target)
  if (dir) {
    for (const [file, label] of MARKERS) {
      if (await exists(path.join(dir, file))) return label
    }
  }

  const head = await value(target, ['symbolic-ref', '--short', '-q', 'HEAD'])
  if (!head) return 'detached HEAD'

  return head === branch ? null : `worktree is on ${head}`
}

export async function keep(target: string, branch: string, repo: string): Promise<GitResult<OpenedBranch>> {
  if (badArgument(branch)) return { ok: false, error: { kind: 'bad-argument', value: branch } }

  const stop = await blocker(target, branch)
  if (stop) {
    return { ok: true, value: { path: target, pulled: false, warning: `Skipped pull of ${branch}: ${stop}. Resolve it there, then reopen to pull.` } }
  }

  const { remote, tracking } = await upstream(target, branch, repo)
  await git(target, ['fetch', remote])

  if (!(await succeeds(target, ['rev-parse', '--verify', '--quiet', tracking]))) {
    return { ok: true, value: { path: target, pulled: false, warning: `${branch} has no ${tracking}: opened without pulling` } }
  }

  const replayed = await git(target, ['rebase', '--autostash', tracking])
  if (replayed.ok) return { ok: true, value: { path: target, pulled: true, warning: null } }

  const conflicted = await rebasing(target)
  if (conflicted) await git(target, ['rebase', '--abort'])

  const how = conflicted ? 'conflicted' : 'failed'
  return { ok: true, value: { path: target, pulled: false, warning: `Pull of ${branch} from ${tracking} ${how}: rolled back, worktree untouched` } }
}

export async function clean(
  basePath: string,
  wipePath: string,
  target: string,
  branch: string,
  repo: string,
  pr?: number,
): Promise<GitResult<OpenedBranch>> {
  if (badArgument(wipePath)) return { ok: false, error: { kind: 'bad-argument', value: wipePath } }
  if (badArgument(branch)) return { ok: false, error: { kind: 'bad-argument', value: branch } }

  const remote = (await remoteFor(basePath, repo)) ?? 'origin'

  if (wipePath === (await listWorktrees(basePath))[0]?.path) {
    await git(basePath, ['fetch', remote])

    const tracking = `${remote}/${branch}`
    if (!(await succeeds(basePath, ['rev-parse', '--verify', '--quiet', tracking]))) {
      return { ok: false, error: { kind: 'no-tracking', tracking } }
    }

    const moved = await git(basePath, ['checkout', '--force', branch])
    if (!moved.ok) return moved

    const reset = await git(basePath, ['reset', '--hard', tracking])
    await git(basePath, ['clean', '-fdx'])
    if (!reset.ok) return reset

    return { ok: true, value: { path: basePath, pulled: true, warning: null } }
  }

  await git(basePath, ['worktree', 'remove', '--force', '--force', wipePath])
  if (await isDir(wipePath)) await fs.rm(wipePath, { recursive: true, force: true }).catch(() => {})
  await git(basePath, ['worktree', 'prune'])
  if (await isDir(wipePath)) return { ok: false, error: { kind: 'worktree-stuck', path: wipePath } }

  return create(basePath, target, branch, repo, pr)
}
