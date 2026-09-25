import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ClaudeWorktree, Worktree } from '../../shared/types'
import { git, parseStatus, parseWorktrees } from './git'

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
