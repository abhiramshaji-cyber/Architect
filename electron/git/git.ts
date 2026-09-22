import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

const MAX_OUTPUT = 64 * 1024 * 1024

export type Head =
  | { kind: 'branch'; branch: string; commit: string | null }
  | { kind: 'detached'; commit: string }

export type GitStatus = {
  head: Head
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
  dirty: boolean
}

export type Worktree = {
  path: string
  head: string | null
  branch: string | null
  detached: boolean
  bare: boolean
  locked: boolean
  prunable: boolean
  exists: boolean
}

export type DefaultBranch = { remote: string; branch: string }

export type GitFailure =
  | { kind: 'not-installed' }
  | { kind: 'missing-root'; root: string }
  | { kind: 'not-a-repo'; root: string }
  | { kind: 'no-commits'; root: string }
  | { kind: 'no-remote'; root: string }
  | { kind: 'no-default-branch'; remote: string }
  | { kind: 'bad-ref'; ref: string }
  | { kind: 'not-in-ref'; ref: string; file: string }
  | { kind: 'bad-argument'; value: string }
  | { kind: 'invalid-branch'; name: string }
  | { kind: 'branch-exists'; name: string }
  | { kind: 'worktree-exists'; path: string }
  | { kind: 'dirty'; root: string }
  | { kind: 'failed'; args: string[]; code: number | null; stderr: string }

export type GitResult<T> = { ok: true; value: T } | { ok: false; error: GitFailure }

type ExecFailure = { code?: unknown; syscall?: unknown; stderr?: unknown }

function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Buffer) return value.toString('utf8')
  return ''
}

function exitCode(error: ExecFailure): number | null {
  return typeof error.code === 'number' ? error.code : null
}

function spawnFailed(error: ExecFailure): boolean {
  return error.code === 'ENOENT' && typeof error.syscall === 'string' && error.syscall.startsWith('spawn')
}

async function succeeds(root: string, args: string[]): Promise<boolean> {
  try {
    await run('git', args, { cwd: root, maxBuffer: MAX_OUTPUT, windowsHide: true })
    return true
  } catch {
    return false
  }
}

async function classify(root: string, args: string[], error: ExecFailure): Promise<GitFailure> {
  if (spawnFailed(error)) {
    const reachable = await fs.stat(root).then(
      (stat) => stat.isDirectory(),
      () => false,
    )
    return reachable ? { kind: 'not-installed' } : { kind: 'missing-root', root }
  }

  if (!(await succeeds(root, ['rev-parse', '--git-dir']))) return { kind: 'not-a-repo', root }
  if (!(await succeeds(root, ['rev-parse', '--verify', '--quiet', 'HEAD']))) return { kind: 'no-commits', root }

  return { kind: 'failed', args, code: exitCode(error), stderr: text(error.stderr).trim() }
}

async function git(root: string, args: string[]): Promise<GitResult<string>> {
  try {
    const { stdout } = await run('git', args, { cwd: root, maxBuffer: MAX_OUTPUT, windowsHide: true })
    return { ok: true, value: text(stdout) }
  } catch (error) {
    return { ok: false, error: await classify(root, args, error as ExecFailure) }
  }
}

const ESCAPES: Record<string, string> = {
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
  '"': '"',
}

export function unquotePath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return raw

  const body = raw.slice(1, -1)
  const bytes: number[] = []

  let i = 0
  while (i < body.length) {
    const char = body[i] ?? ''

    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'))
      i += 1
      continue
    }

    const next = body[i + 1] ?? ''
    const mapped = ESCAPES[next]
    if (mapped !== undefined) {
      bytes.push(...Buffer.from(mapped, 'utf8'))
      i += 2
      continue
    }

    const octal = body.slice(i + 1, i + 4)
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8))
      i += 4
      continue
    }

    bytes.push(...Buffer.from(next, 'utf8'))
    i += 2
  }

  return Buffer.from(bytes).toString('utf8')
}

function headOf(oid: string, name: string): Head {
  if (name === '(detached)') return { kind: 'detached', commit: oid }
  return { kind: 'branch', branch: name, commit: oid === '(initial)' ? null : oid }
}

export function parseStatus(stdout: string): GitStatus {
  const fields = stdout.split('\0')

  let oid = '(initial)'
  let name = '(detached)'
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  let staged = 0
  let unstaged = 0
  let untracked = 0
  let conflicted = 0

  let i = 0
  while (i < fields.length) {
    const field = fields[i]
    i += 1
    if (field === undefined || field === '') continue

    if (field.startsWith('# branch.oid ')) oid = field.slice(13)
    else if (field.startsWith('# branch.head ')) name = field.slice(14)
    else if (field.startsWith('# branch.upstream ')) upstream = field.slice(18)
    else if (field.startsWith('# branch.ab ')) {
      const [plus, minus] = field.slice(12).split(' ')
      ahead = Number.parseInt(plus ?? '', 10) || 0
      behind = Math.abs(Number.parseInt(minus ?? '', 10) || 0)
    } else if (field.startsWith('1 ') || field.startsWith('2 ')) {
      const [x, y] = field.slice(2, 4)
      if (x !== undefined && x !== '.') staged += 1
      if (y !== undefined && y !== '.') unstaged += 1
      if (field.startsWith('2 ')) i += 1
    } else if (field.startsWith('u ')) conflicted += 1
    else if (field.startsWith('? ')) untracked += 1
  }

  return {
    head: headOf(oid, name),
    upstream,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    conflicted,
    dirty: staged + unstaged + untracked + conflicted > 0,
  }
}

export function parseWorktrees(stdout: string): Omit<Worktree, 'exists'>[] {
  const found: Omit<Worktree, 'exists'>[] = []
  let current: Omit<Worktree, 'exists'> | null = null

  for (const line of stdout.split('\n')) {
    if (line === '') continue

    const space = line.indexOf(' ')
    const key = space === -1 ? line : line.slice(0, space)
    const value = space === -1 ? '' : line.slice(space + 1)

    if (key === 'worktree') {
      current = { path: unquotePath(value), head: null, branch: null, detached: false, bare: false, locked: false, prunable: false }
      found.push(current)
      continue
    }

    if (!current) continue

    if (key === 'HEAD') current.head = value
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '')
    else if (key === 'detached') current.detached = true
    else if (key === 'bare') current.bare = true
    else if (key === 'locked') current.locked = true
    else if (key === 'prunable') current.prunable = true
  }

  return found
}

export async function status(root: string): Promise<GitResult<GitStatus>> {
  const out = await git(root, ['status', '--porcelain=v2', '--branch', '-z'])
  return out.ok ? { ok: true, value: parseStatus(out.value) } : out
}

export async function head(root: string): Promise<GitResult<Head>> {
  const out = await status(root)
  return out.ok ? { ok: true, value: out.value.head } : out
}

export async function worktrees(root: string): Promise<GitResult<Worktree[]>> {
  const out = await git(root, ['worktree', 'list', '--porcelain'])
  if (!out.ok) return out

  const listed = parseWorktrees(out.value)
  const value = await Promise.all(
    listed.map(async (entry) => ({
      ...entry,
      exists: await fs.stat(entry.path).then(
        (stat) => stat.isDirectory(),
        () => false,
      ),
    })),
  )

  return { ok: true, value }
}

export async function defaultBranch(root: string): Promise<GitResult<DefaultBranch>> {
  const listed = await git(root, ['remote'])
  if (!listed.ok) return listed

  const remotes = listed.value.split('\n').map((line) => line.trim()).filter(Boolean)
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  if (remote === undefined) return { ok: false, error: { kind: 'no-remote', root } }

  const symbolic = await git(root, ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`])
  if (!symbolic.ok) {
    return symbolic.error.kind === 'failed'
      ? { ok: false, error: { kind: 'no-default-branch', remote } }
      : symbolic
  }

  const short = symbolic.value.trim()
  const prefix = `${remote}/`
  const branch = short.startsWith(prefix) ? short.slice(prefix.length) : short
  return branch ? { ok: true, value: { remote, branch } } : { ok: false, error: { kind: 'no-default-branch', remote } }
}

function badArgument(value: string): boolean {
  return value === '' || value.startsWith('-') || value.includes('\0')
}

async function branchExists(root: string, name: string): Promise<boolean> {
  return succeeds(root, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`])
}

async function resolveBase(root: string, name: string): Promise<GitResult<DefaultBranch>> {
  if (badArgument(name)) return { ok: false, error: { kind: 'bad-argument', value: name } }
  if (!(await succeeds(root, ['check-ref-format', '--branch', name]))) return { ok: false, error: { kind: 'invalid-branch', name } }
  if (await branchExists(root, name)) return { ok: false, error: { kind: 'branch-exists', name } }

  const base = await defaultBranch(root)
  if (!base.ok) return base

  const fetched = await git(root, ['fetch', base.value.remote, base.value.branch])
  if (!fetched.ok) return fetched

  return base
}

export async function createBranch(root: string, name: string): Promise<GitResult<{ branch: string; base: string }>> {
  const base = await resolveBase(root, name)
  if (!base.ok) return base

  const state = await status(root)
  if (!state.ok) return state
  if (state.value.dirty) return { ok: false, error: { kind: 'dirty', root } }

  const startPoint = `${base.value.remote}/${base.value.branch}`
  const checkout = await git(root, ['checkout', '-b', name, startPoint])
  if (!checkout.ok) return checkout

  return { ok: true, value: { branch: name, base: startPoint } }
}

export async function createWorktree(root: string, worktreePath: string, name: string): Promise<GitResult<{ path: string; branch: string; base: string }>> {
  if (badArgument(worktreePath)) return { ok: false, error: { kind: 'bad-argument', value: worktreePath } }

  const occupied = await fs.stat(worktreePath).then(
    () => true,
    () => false,
  )
  if (occupied) return { ok: false, error: { kind: 'worktree-exists', path: worktreePath } }

  const base = await resolveBase(root, name)
  if (!base.ok) return base

  const startPoint = `${base.value.remote}/${base.value.branch}`
  const added = await git(root, ['worktree', 'add', '-b', name, worktreePath, startPoint])
  if (!added.ok) return added

  return { ok: true, value: { path: worktreePath, branch: name, base: startPoint } }
}

export async function fileAtRef(root: string, ref: string, file: string): Promise<GitResult<string>> {
  for (const value of [ref, file]) {
    if (value === '' || value.startsWith('-') || value.includes('\0')) return { ok: false, error: { kind: 'bad-argument', value } }
  }

  const out = await git(root, ['show', `${ref}:${file}`])
  if (out.ok || out.error.kind !== 'failed') return out

  const resolved = await succeeds(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  return { ok: false, error: resolved ? { kind: 'not-in-ref', ref, file } : { kind: 'bad-ref', ref } }
}
