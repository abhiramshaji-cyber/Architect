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
  SettingsProblem,
  SettingsResult,
  Worktree,
  WorktreeRemoval,
  WorktreeRemoved,
  WorktreeSettings,
} from '../../shared/types'
import { defaultBranch, git, parseStatus, parseWorktrees, succeeds } from './git'

const LANES = 8
const LEAVE_INDEX_ALONE = '--no-optional-locks'
const SKIP = new Set(['node_modules', 'Library', 'AppData', '.Trash', '.cache', '.npm', '.cargo', '.rustup'])
const PATH_FIELD: Record<string, number> = { '1': 8, '2': 9, u: 10, '?': 1 }

type Listed = Omit<Worktree, 'exists'>
type Found = { path: string; git: boolean }
type Entry = Omit<ClaudeWorktree, 'dirty' | 'changedAt'>

export function defaults(home = os.homedir()): WorktreeSettings {
  return { worktreeRoots: [home], worktreeScanDepth: 6, worktreeFolders: ['.claude/worktrees'] }
}

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

function present<T>(value: T | null): value is T {
  return value !== null
}

async function realDirs(dirs: string[]): Promise<string[]> {
  const real = await Promise.all(dirs.map((dir) => fs.realpath(dir).catch(() => null)))
  return [...new Set(real.filter(present))]
}

export async function findRepos(roots: string[], depth: number): Promise<string[]> {
  const mains: string[] = []
  const links: string[] = []
  let level = await realDirs(roots)
  const seen = new Set(level)

  for (let at = 0; at <= depth && level.length > 0; at += 1) {
    const read = await Promise.all(level.map(async (dir) => ({ dir, entries: await readDir(dir) })))
    level = []
    for (const { dir, entries } of read) {
      for (const entry of entries) {
        const child = path.join(dir, entry.name)
        if (entry.name === '.git') (entry.isDirectory() ? mains : links).push(dir)
        else if (entry.isDirectory() && !SKIP.has(entry.name) && !seen.has(child)) {
          seen.add(child)
          level.push(child)
        }
      }
    }
  }

  const linked = await pooled(links, repoOf)
  return [...mains, ...linked.filter(present)]
}

async function repoOf(root: string): Promise<string | null> {
  const common = await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (!common.ok) return null

  const dir = common.value.trim()
  return path.basename(dir) === '.git' ? path.dirname(dir) : null
}

export function within(root: string, target: string): boolean {
  const relative = path.relative(target, root)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function inside(target: string, holder: string): boolean {
  return target !== holder && within(target, holder)
}

export function classify(repo: string, holders: string[], found: Found[], listed: Worktree[] | null): Entry[] {
  const linked = (listed ?? []).slice(1).filter((worktree) => !worktree.bare)
  const registered = new Set((listed ?? []).map((worktree) => worktree.path))

  const worktrees = linked.map(
    (worktree): Entry => ({
      repo,
      name: path.basename(worktree.path),
      path: worktree.path,
      branch: worktree.branch,
      broken: worktree.exists ? null : 'missing',
      claude: holders.some((holder) => inside(worktree.path, holder)),
    }),
  )

  const plain = found
    .filter(({ path: dir }) => !registered.has(dir) && !holders.includes(dir) && !linked.some((worktree) => inside(worktree.path, dir)))
    .map(
      ({ path: dir, git: hasGit }): Entry => ({
        repo,
        name: path.basename(dir),
        path: dir,
        branch: null,
        broken: listed === null ? 'unlisted' : hasGit ? 'unregistered' : 'not-git',
        claude: true,
      }),
    )

  return [...worktrees, ...plain]
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

function plainHolders(repo: string, folders: string[]): string[] {
  return folders.filter((folder) => !path.isAbsolute(folder)).map((folder) => path.join(repo, folder))
}

async function foldersIn(holders: string[]): Promise<Found[]> {
  const read = await Promise.all(holders.map(async (holder) => ({ holder, entries: await readDir(holder) })))
  const dirs = [...new Set(read.flatMap(({ holder, entries }) => entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(holder, entry.name))))]
  return Promise.all(dirs.map(async (dir) => ({ path: dir, git: Number.isFinite(await mtime(path.join(dir, '.git'))) })))
}

async function entriesOf(repo: string, folders: string[]): Promise<Entry[]> {
  const [found, listed] = await Promise.all([foldersIn(plainHolders(repo, folders)), listedIn(repo)])
  const known = listed.ok ? await Promise.all(listed.value.map(async (worktree) => ({ ...worktree, exists: await isDir(worktree.path) }))) : null
  return classify(repo, folders.map((folder) => path.resolve(repo, folder)), found, known)
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

export async function discover(known: string[], scan: boolean, settings: WorktreeSettings): Promise<ClaudeWorktree[]> {
  const [opened, scanned] = await Promise.all([
    pooled(known, repoOf),
    scan ? findRepos(settings.worktreeRoots, settings.worktreeScanDepth) : [],
  ])

  const repos = await realDirs([...opened.filter(present), ...scanned])
  const entries = (await pooled(repos, (repo) => entriesOf(repo, settings.worktreeFolders))).flat()
  return (await pooled(entries, inspect)).sort(byRecency)
}

type GitFailed = { ok: false; error: { kind: 'git'; error: GitFailure; left: RemovalLeft } }

function gitFailed(error: GitFailure, left: RemovalLeft = 'both'): GitFailed {
  return { ok: false, error: { kind: 'git', error, left } }
}

function real(target: string): Promise<string> {
  return fs.realpath(target).catch(() => path.resolve(target))
}

async function listedIn(repo: string): Promise<{ ok: true; value: Listed[] } | { ok: false; error: GitFailure }> {
  const listed = await git(repo, ['worktree', 'list', '--porcelain'])
  if (!listed.ok) return listed
  return { ok: true, value: parseWorktrees(listed.value).map((worktree) => ({ ...worktree, path: path.resolve(worktree.path) })) }
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

export async function survey(
  repo: string,
  target: string,
  open: string[],
  folders: string[],
): Promise<RemovalResult<WorktreeRemoval>> {
  const home = await real(repo)
  const spot = path.resolve(target)
  const roots = await Promise.all(open.map(real))
  if (roots.some((root) => within(root, spot))) return { ok: false, error: { kind: 'open', path: spot } }

  const [listed, stat] = await Promise.all([listedIn(home), fs.lstat(spot).catch(() => null)])
  if (!listed.ok) return gitFailed(listed.error)

  const [main, ...linked] = listed.value
  if (within(home, spot) || (main && within(main.path, spot))) return { ok: false, error: { kind: 'main', path: spot } }
  const held = linked.find((worktree) => inside(worktree.path, spot))
  if (held) return { ok: false, error: { kind: 'holds', path: spot, worktree: held.path } }

  const entry = linked.find((worktree) => worktree.path === spot)
  if (!stat) return entry ? { ok: true, value: { kind: 'prune' } } : gitFailed({ kind: 'no-worktree', path: spot }, 'neither')
  if (!stat.isDirectory() || (await real(spot)) !== spot) return { ok: false, error: { kind: 'outside', path: spot } }
  if (entry) return risk(home, entry, main)

  if (!plainHolders(home, folders).includes(path.dirname(spot))) return { ok: false, error: { kind: 'outside', path: spot } }
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
  folders: string[],
  trash: (target: string) => Promise<void>,
): Promise<RemovalResult<WorktreeRemoved>> {
  const surveyed = await survey(repo, target, open, folders)
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

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null
}

function isDepth(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function fields(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function segments(folder: string): string[] {
  return path.normalize(folder).split(path.sep).filter((part) => part !== '' && part !== '.')
}

function relativeProblem(folder: string): SettingsProblem['kind'] | null {
  const parts = segments(folder)
  if (parts.length === 0) return 'empty'
  return parts[0] === '..' ? 'escapes' : null
}

function cleaned(folder: string): string {
  return path.isAbsolute(folder) ? path.resolve(folder) : path.join(...segments(folder))
}

async function placeProblem(target: string): Promise<SettingsProblem['kind'] | null> {
  if (!path.isAbsolute(target)) return 'relative'
  const stat = await fs.stat(target).catch(() => null)
  if (!stat) return 'missing'
  return stat.isDirectory() ? null : 'not-folder'
}

export async function readSettings(file: string, home = os.homedir()): Promise<WorktreeSettings> {
  const stored = fields(await fs.readFile(file, 'utf8').then(JSON.parse, () => null).catch(() => null))
  const base = defaults(home)
  const roots = strings(stored.worktreeRoots)
  const folders = strings(stored.worktreeFolders)

  return {
    worktreeRoots: roots ? roots.filter((root) => path.isAbsolute(root)) : base.worktreeRoots,
    worktreeScanDepth: isDepth(stored.worktreeScanDepth) ? stored.worktreeScanDepth : base.worktreeScanDepth,
    worktreeFolders: folders
      ? folders.filter((folder) => path.isAbsolute(folder) || relativeProblem(folder) === null).map(cleaned)
      : base.worktreeFolders,
  }
}

async function listProblems(
  field: 'worktreeRoots' | 'worktreeFolders',
  items: string[],
  check: (item: string) => Promise<SettingsProblem['kind'] | null>,
): Promise<SettingsProblem[]> {
  const kinds = await Promise.all(items.map(check))
  const seen = new Set<string>()

  return items.flatMap((value, at): SettingsProblem[] => {
    const kind = kinds[at]
    if (kind) return [{ field, value, kind }]

    const key = cleaned(value)
    if (seen.has(key)) return [{ field, value, kind: 'duplicate' }]
    seen.add(key)
    return []
  })
}

export async function checkSettings(input: unknown): Promise<SettingsResult> {
  const given = fields(input)
  const roots = strings(given.worktreeRoots)
  const folders = strings(given.worktreeFolders)
  const depth = given.worktreeScanDepth

  const problems: SettingsProblem[] = [
    ...(roots ? await listProblems('worktreeRoots', roots, placeProblem) : [{ field: 'worktreeRoots' as const, value: '', kind: 'not-list' as const }]),
    ...(folders
      ? await listProblems('worktreeFolders', folders, async (folder) =>
          path.isAbsolute(folder) ? placeProblem(folder) : relativeProblem(folder),
        )
      : [{ field: 'worktreeFolders' as const, value: '', kind: 'not-list' as const }]),
    ...(isDepth(depth) ? [] : [{ field: 'worktreeScanDepth' as const, value: String(depth), kind: 'depth' as const }]),
  ]
  if (problems.length > 0 || !roots || !folders || !isDepth(depth)) return { ok: false, error: problems }

  return {
    ok: true,
    value: { worktreeRoots: roots.map(cleaned), worktreeScanDepth: depth, worktreeFolders: folders.map(cleaned) },
  }
}

export async function saveSettings(file: string, input: unknown): Promise<SettingsResult> {
  const checked = await checkSettings(input)
  if (!checked.ok) return checked

  const stored = fields(await fs.readFile(file, 'utf8').then(JSON.parse, () => null).catch(() => null))
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify({ ...stored, ...checked.value }, null, 2))
  return checked
}
