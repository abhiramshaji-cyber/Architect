import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  ClaudeWorktree,
  GitFailure,
  RemovalChoice,
  RemovalLeft,
  RemovalResult,
  Worktree,
  WorktreeRemoval,
  WorktreeRemoved,
} from '../../shared/types'
import { defaultBranch, git, parseStatus, parseWorktrees, succeeds } from './git'

const HOLDER = path.join('.claude', 'worktrees')
const SCAN_DEPTH = 6
const LANES = 8
const LEAVE_INDEX_ALONE = '--no-optional-locks'
const SKIP = new Set(['node_modules', 'Library', '.git', '.Trash', '.cache', '.npm', '.cargo', '.rustup'])
const PATH_FIELD: Record<string, number> = { '1': 8, '2': 9, u: 10, '?': 1 }

type Listed = Omit<Worktree, 'exists'>
type Found = { name: string; git: boolean }
type Entry = Omit<ClaudeWorktree, 'dirty' | 'changedAt'>

function readDir(dir: string): Promise<Dirent[]> {
  return fs.readdir(dir, { withFileTypes: true }).catch(() => [])
}

function isDir(target: string): Promise<boolean> {
  return fs.stat(target).then(
    (stat) => stat.isDirectory(),
    () => false,
  )
}

function mtime(target: string): Promise<number> {
  return fs.lstat(target).then(
    (stat) => stat.mtimeMs,
    () => Number.NaN,
  )
}

export async function findRepos(home: string, depth = SCAN_DEPTH): Promise<string[]> {
  const holders: string[] = []
  let level = [home]

  for (let at = 0; at <= depth && level.length > 0; at += 1) {
    const read = await Promise.all(level.map(async (dir) => ({ dir, entries: await readDir(dir) })))
    level = []
    for (const { dir, entries } of read) {
      for (const entry of entries) {
        if (!entry.isDirectory() || SKIP.has(entry.name)) continue
        if (entry.name === '.claude') holders.push(dir)
        else level.push(path.join(dir, entry.name))
      }
    }
  }

  const held = await Promise.all(holders.map((dir) => isDir(path.join(dir, HOLDER))))
  return holders.filter((_, at) => held[at])
}

async function repoOf(root: string): Promise<string | null> {
  const common = await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (!common.ok) return null

  const dir = common.value.trim()
  return path.basename(dir) === '.git' ? path.dirname(dir) : null
}

export function classify(repo: string, found: Found[], listed: Listed[] | null): Entry[] {
  const holder = path.join(repo, HOLDER)
  const registered = new Map(
    (listed ?? [])
      .filter((worktree) => path.dirname(worktree.path) === holder)
      .map((worktree) => [path.basename(worktree.path), worktree]),
  )

  const present = found.map(({ name, git: hasGit }): Entry => {
    const worktree = registered.get(name)
    const broken = listed === null ? 'unlisted' : worktree ? null : hasGit ? 'unregistered' : 'not-git'
    return {
      repo,
      name,
      path: path.join(holder, name),
      branch: worktree?.branch ?? null,
      broken,
    }
  })

  const names = new Set(found.map((entry) => entry.name))
  const missing = [...registered]
    .filter(([name]) => !names.has(name))
    .map(([name, worktree]): Entry => ({
      repo,
      name,
      path: worktree.path,
      branch: worktree.branch,
      broken: 'missing',
    }))

  return [...present, ...missing]
}

export function changedPaths(stdout: string): string[] {
  const fields = stdout.split('\0')
  const paths: string[] = []

  for (let at = 0; at < fields.length; at += 1) {
    const field = fields[at] ?? ''
    const skip = PATH_FIELD[field[0] ?? '']
    if (skip === undefined || field[1] !== ' ') continue

    paths.push(field.split(' ').slice(skip).join(' '))
    if (field[0] === '2') at += 1
  }

  return paths
}

export function byRecency(a: ClaudeWorktree, b: ClaudeWorktree): number {
  return (
    (b.changedAt ?? -Infinity) - (a.changedAt ?? -Infinity) ||
    a.repo.localeCompare(b.repo) ||
    a.name.localeCompare(b.name)
  )
}

async function entriesOf(repo: string): Promise<Entry[]> {
  const holder = path.join(repo, HOLDER)
  const dirs = (await readDir(holder)).filter((entry) => entry.isDirectory())
  const found = await Promise.all(
    dirs.map(async (entry) => ({
      name: entry.name,
      git: Number.isFinite(await mtime(path.join(holder, entry.name, '.git'))),
    })),
  )

  const listed = await git(repo, ['worktree', 'list', '--porcelain'])
  return classify(repo, found, listed.ok ? parseWorktrees(listed.value) : null)
}

async function inspect(entry: Entry): Promise<ClaudeWorktree> {
  if (entry.broken) return { ...entry, dirty: false, changedAt: null }

  const [status, log] = await Promise.all([
    git(entry.path, [LEAVE_INDEX_ALONE, 'status', '--porcelain=v2', '--branch', '-z']),
    git(entry.path, ['log', '-1', '--format=%ct']),
  ])
  if (!status.ok) return { ...entry, broken: 'unreadable', dirty: false, changedAt: null }

  const { head, dirty } = parseStatus(status.value)
  const committed = log.ok ? Number.parseInt(log.value, 10) * 1000 : Number.NaN
  const touched = await Promise.all(changedPaths(status.value).map((file) => mtime(path.join(entry.path, file))))
  const changedAt = [committed, ...touched].reduce<number | null>(
    (latest, at) => (Number.isFinite(at) && (latest === null || at > latest) ? at : latest),
    null,
  )

  return {
    ...entry,
    branch: head.kind === 'branch' ? head.branch : null,
    dirty,
    changedAt,
  }
}

async function pooled<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let next = 0

  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const at = next++
      out[at] = await fn(items[at] as T)
    }
  }

  await Promise.all(Array.from({ length: Math.min(LANES, items.length) }, lane))
  return out
}

export async function discover(roots: string[], scan: boolean, home = os.homedir()): Promise<ClaudeWorktree[]> {
  const [known, scanned] = await Promise.all([Promise.all(roots.map(repoOf)), scan ? findRepos(home) : []])
  const real = await Promise.all(
    [...known, ...scanned]
      .filter((repo): repo is string => repo !== null)
      .map((repo) => fs.realpath(repo).catch(() => null)),
  )

  const repos = [...new Set(real.filter((repo): repo is string => repo !== null))]
  const entries = (await pooled(repos, entriesOf)).flat()
  return (await pooled(entries, inspect)).sort(byRecency)
}

type GitFailed = { ok: false; error: { kind: 'git'; error: GitFailure; left: RemovalLeft } }

function gitFailed(error: GitFailure, left: RemovalLeft = 'both'): GitFailed {
  return { ok: false, error: { kind: 'git', error, left } }
}

function real(target: string): Promise<string> {
  return fs.realpath(target).catch(() => path.resolve(target))
}

export function within(root: string, target: string): boolean {
  const relative = path.relative(target, root)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function listedIn(repo: string): Promise<{ ok: true; value: Listed[] } | { ok: false; error: GitFailure }> {
  const listed = await git(repo, ['worktree', 'list', '--porcelain'])
  return listed.ok ? { ok: true, value: parseWorktrees(listed.value) } : listed
}

async function leftAt(repo: string, spot: string): Promise<RemovalLeft> {
  const [listed, stat] = await Promise.all([listedIn(repo), fs.lstat(spot).catch(() => null)])
  const registered = !listed.ok || listed.value.some((worktree) => worktree.path === spot)
  if (registered) return stat ? 'both' : 'registration'
  return stat ? 'folder' : 'neither'
}

async function baseOf(repo: string, main: Listed | undefined): Promise<{ ref: string; branch: string } | null> {
  const found = await defaultBranch(repo)
  if (found.ok) return { ref: `${found.value.remote}/${found.value.branch}`, branch: found.value.branch }
  return main?.branch ? { ref: main.branch, branch: main.branch } : null
}

async function risk(repo: string, entry: Listed, main: Listed | undefined): Promise<RemovalResult<WorktreeRemoval>> {
  const status = await git(entry.path, [LEAVE_INDEX_ALONE, 'status', '--porcelain=v2', '-z'])
  if (!status.ok) return gitFailed(status.error)

  const base = await baseOf(repo, main)
  const keep = entry.branch ? (base ? [base.ref] : []) : ['--branches']
  const counted = await git(entry.path, ['rev-list', '--count', 'HEAD', '--not', '--remotes', ...keep])
  if (!counted.ok && counted.error.kind !== 'no-commits') return gitFailed(counted.error)

  const merged =
    entry.branch !== null &&
    base !== null &&
    entry.branch !== base.branch &&
    (await succeeds(repo, ['merge-base', '--is-ancestor', `refs/heads/${entry.branch}`, base.ref]))

  return {
    ok: true,
    value: {
      kind: 'remove',
      dirty: changedPaths(status.value).length,
      unpushed: counted.ok ? Number.parseInt(counted.value, 10) || 0 : 0,
      branch: entry.branch,
      base: base?.ref ?? null,
      merged,
    },
  }
}

export async function survey(repo: string, target: string, open: string[]): Promise<RemovalResult<WorktreeRemoval>> {
  const home = await real(repo)
  const spot = path.resolve(target)
  const name = path.basename(spot)
  if (path.dirname(spot) !== path.join(home, HOLDER) || name === '' || name === '.' || name === '..') {
    return { ok: false, error: { kind: 'outside', path: spot } }
  }

  const roots = await Promise.all(open.map(real))
  if (roots.some((root) => within(root, spot))) return { ok: false, error: { kind: 'open', path: spot } }

  const [listed, stat] = await Promise.all([listedIn(home), fs.lstat(spot).catch(() => null)])
  if (!listed.ok) return gitFailed(listed.error)

  const entry = listed.value.find((worktree) => worktree.path === spot)
  if (!stat) return entry ? { ok: true, value: { kind: 'prune' } } : gitFailed({ kind: 'no-worktree', path: spot }, 'neither')
  if (!stat.isDirectory() || (await real(spot)) !== spot) return { ok: false, error: { kind: 'outside', path: spot } }
  if (entry) return risk(home, entry, listed.value[0])

  const hasGit = Number.isFinite(await mtime(path.join(spot, '.git')))
  return hasGit ? { ok: false, error: { kind: 'unregistered', path: spot, repo: home } } : { ok: true, value: { kind: 'trash' } }
}

async function removeListed(
  repo: string,
  spot: string,
  plan: Extract<WorktreeRemoval, { kind: 'remove' }>,
  choice: RemovalChoice,
): Promise<RemovalResult<WorktreeRemoved>> {
  const force = choice.force && plan.dirty > 0 ? ['--force'] : []
  const removed = await git(repo, ['worktree', 'remove', ...force, spot])
  if (!removed.ok) return gitFailed(removed.error, await leftAt(repo, spot))

  const branch = choice.branch && plan.merged ? plan.branch : null
  const dropped = branch ? await git(repo, ['branch', '-d', branch]) : null
  return {
    ok: true,
    value: { how: 'remove', branch: dropped?.ok ? branch : null, branchError: dropped && !dropped.ok ? dropped.error : null },
  }
}

export async function remove(
  repo: string,
  target: string,
  choice: RemovalChoice,
  open: string[],
  trash: (target: string) => Promise<void>,
): Promise<RemovalResult<WorktreeRemoved>> {
  const surveyed = await survey(repo, target, open)
  if (!surveyed.ok) return surveyed

  const home = await real(repo)
  const spot = path.resolve(target)
  const plan = surveyed.value
  if (plan.kind === 'remove') return removeListed(home, spot, plan, choice)

  if (plan.kind === 'trash') {
    try {
      await trash(spot)
    } catch (error) {
      return { ok: false, error: { kind: 'trash-failed', path: spot, message: error instanceof Error ? error.message : String(error) } }
    }
    return { ok: true, value: { how: 'trash', branch: null, branchError: null } }
  }

  const pruned = await git(home, ['worktree', 'prune'])
  if (!pruned.ok) return gitFailed(pruned.error, await leftAt(home, spot))

  const left = await leftAt(home, spot)
  if (left === 'registration') return gitFailed({ kind: 'locked-worktree', path: spot }, left)

  return { ok: true, value: { how: 'prune', branch: null, branchError: null } }
}
