import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import net from 'node:net'
import { promisify } from 'node:util'
import type {
  BaseDistance,
  Committed,
  DefaultBranch,
  GitFailure,
  GitResult,
  GitStatus,
  Head,
  LocalBranch,
  Pulled,
  Pushed,
  RemoteBranch,
  Worktree,
  WorktreeCreated,
} from '../../shared/types'

const run = promisify(execFile)

const MAX_OUTPUT = 64 * 1024 * 1024
const CONNECT_MS = 5000
const PORTS: Record<string, number> = { https: 443, http: 80, ssh: 22, git: 9418 }

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

export async function succeeds(root: string, args: string[]): Promise<boolean> {
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

export async function git(root: string, args: string[]): Promise<GitResult<string>> {
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

async function remoteName(root: string): Promise<GitResult<string>> {
  const listed = await git(root, ['remote'])
  if (!listed.ok) return listed

  const remotes = listed.value.split('\n').map((line) => line.trim()).filter(Boolean)
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  return remote === undefined ? { ok: false, error: { kind: 'no-remote', root } } : { ok: true, value: remote }
}

export async function defaultBranch(root: string): Promise<GitResult<DefaultBranch>> {
  const remote = await remoteName(root)
  if (!remote.ok) return remote

  const symbolic = await git(root, ['symbolic-ref', '--short', `refs/remotes/${remote.value}/HEAD`])
  if (!symbolic.ok) {
    return symbolic.error.kind === 'failed'
      ? { ok: false, error: { kind: 'no-default-branch', remote: remote.value } }
      : symbolic
  }

  const short = symbolic.value.trim()
  const prefix = `${remote.value}/`
  const branch = short.startsWith(prefix) ? short.slice(prefix.length) : short
  return branch
    ? { ok: true, value: { remote: remote.value, branch } }
    : { ok: false, error: { kind: 'no-default-branch', remote: remote.value } }
}

export async function distance(root: string): Promise<GitResult<BaseDistance>> {
  const found = await defaultBranch(root)
  if (!found.ok) return found

  const base = `${found.value.remote}/${found.value.branch}`
  const counted = await git(root, ['rev-list', '--left-right', '--count', `${base}...HEAD`])
  if (!counted.ok) return counted

  const [behind, ahead] = counted.value.trim().split(/\s+/).map((part) => Number.parseInt(part, 10) || 0)
  return { ok: true, value: { base, ahead: ahead ?? 0, behind: behind ?? 0 } }
}

export async function fetch(root: string): Promise<GitResult<{ remote: string }>> {
  const remote = await remoteName(root)
  if (!remote.ok) return remote

  const fetched = await git(root, ['fetch', remote.value, '--prune'])
  return fetched.ok ? { ok: true, value: { remote: remote.value } } : fetched
}

const REF_FIELDS = ['%(refname:short)', '%(objectname)', '%(upstream:short)', '%(HEAD)', '%(symref)'].join('%09')

async function refs(root: string, namespace: string): Promise<GitResult<string[][]>> {
  const out = await git(root, ['for-each-ref', `--format=${REF_FIELDS}`, namespace])
  if (!out.ok) return out

  const rows = out.value
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('\t'))
    .filter((cells) => (cells[4] ?? '') === '')

  return { ok: true, value: rows }
}

export async function localBranches(root: string): Promise<GitResult<LocalBranch[]>> {
  const rows = await refs(root, 'refs/heads')
  if (!rows.ok) return rows

  const value = rows.value.map((cells) => ({
    name: cells[0] ?? '',
    commit: cells[1] ?? '',
    upstream: cells[2] ? cells[2] : null,
    current: cells[3] === '*',
  }))

  return { ok: true, value }
}

export async function remoteBranches(root: string): Promise<GitResult<RemoteBranch[]>> {
  const remote = await remoteName(root)
  if (!remote.ok) return remote

  const rows = await refs(root, `refs/remotes/${remote.value}`)
  if (!rows.ok) return rows

  return { ok: true, value: rows.value.map((cells) => ({ name: cells[0] ?? '', commit: cells[1] ?? '' })) }
}

function badArgument(value: string): boolean {
  return value === '' || value.startsWith('-') || value.includes('\0')
}

async function branchExists(root: string, name: string): Promise<boolean> {
  return succeeds(root, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`])
}

async function checkedOutAt(root: string, name: string): Promise<GitResult<string | null>> {
  const out = await git(root, ['worktree', 'list', '--porcelain'])
  if (!out.ok) return out

  const holder = parseWorktrees(out.value).find((entry) => entry.branch === name)
  return { ok: true, value: holder ? holder.path : null }
}

async function claimBranch(root: string, name: string): Promise<GitFailure | null> {
  if (badArgument(name)) return { kind: 'bad-argument', value: name }
  if (!(await succeeds(root, ['check-ref-format', '--branch', name]))) return { kind: 'invalid-branch', name }

  const holder = await checkedOutAt(root, name)
  if (!holder.ok) return holder.error
  if (holder.value !== null) return { kind: 'branch-checked-out', name, path: holder.value }

  return (await branchExists(root, name)) ? { kind: 'branch-exists', name } : null
}

async function defaultStart(root: string): Promise<GitResult<string>> {
  const base = await defaultBranch(root)
  if (!base.ok) return base

  const fetched = await git(root, ['fetch', base.value.remote, base.value.branch])
  if (!fetched.ok) return fetched

  return { ok: true, value: `${base.value.remote}/${base.value.branch}` }
}

async function resolveStart(root: string, ref: string): Promise<GitResult<string>> {
  if (badArgument(ref)) return { ok: false, error: { kind: 'bad-argument', value: ref } }

  const commit = `${ref}^{commit}`
  if (await succeeds(root, ['rev-parse', '--verify', '--quiet', commit])) return { ok: true, value: ref }

  const fetched = await fetch(root)
  if (!fetched.ok && fetched.error.kind !== 'no-remote') return fetched

  return (await succeeds(root, ['rev-parse', '--verify', '--quiet', commit]))
    ? { ok: true, value: ref }
    : { ok: false, error: { kind: 'bad-ref', ref } }
}

export async function createBranch(root: string, name: string): Promise<GitResult<{ branch: string; base: string }>> {
  const claimed = await claimBranch(root, name)
  if (claimed) return { ok: false, error: claimed }

  const startPoint = await defaultStart(root)
  if (!startPoint.ok) return startPoint

  const state = await status(root)
  if (!state.ok) return state
  if (state.value.dirty) return { ok: false, error: { kind: 'dirty', root } }

  const checkout = await git(root, ['checkout', '-b', name, startPoint.value])
  if (!checkout.ok) return checkout

  return { ok: true, value: { branch: name, base: startPoint.value } }
}

export async function createWorktree(
  root: string,
  worktreePath: string,
  name: string,
  base?: string,
): Promise<GitResult<WorktreeCreated>> {
  if (badArgument(worktreePath)) return { ok: false, error: { kind: 'bad-argument', value: worktreePath } }

  const occupied = await fs.stat(worktreePath).then(
    () => true,
    () => false,
  )
  if (occupied) return { ok: false, error: { kind: 'worktree-exists', path: worktreePath } }

  const claimed = await claimBranch(root, name)
  if (claimed) return { ok: false, error: claimed }

  const startPoint = base === undefined ? await defaultStart(root) : await resolveStart(root, base)
  if (!startPoint.ok) return startPoint

  const added = await git(root, ['worktree', 'add', '-b', name, worktreePath, startPoint.value])
  if (!added.ok) return added

  return { ok: true, value: { path: worktreePath, branch: name, base: startPoint.value } }
}

export async function pruneWorktrees(root: string): Promise<GitResult<Worktree[]>> {
  const pruned = await git(root, ['worktree', 'prune'])
  if (!pruned.ok) return pruned

  return worktrees(root)
}

export async function removeWorktree(root: string, worktreePath: string): Promise<GitResult<{ path: string }>> {
  if (badArgument(worktreePath)) return { ok: false, error: { kind: 'bad-argument', value: worktreePath } }

  const listed = await worktrees(root)
  if (!listed.ok) return listed

  const entry = listed.value.find((candidate) => candidate.path === worktreePath)
  if (!entry) return { ok: false, error: { kind: 'no-worktree', path: worktreePath } }
  if (entry === listed.value[0]) return { ok: false, error: { kind: 'main-worktree', path: worktreePath } }
  if (entry.locked) return { ok: false, error: { kind: 'locked-worktree', path: worktreePath } }

  if (entry.exists) {
    const removed = await git(root, ['worktree', 'remove', worktreePath])
    if (!removed.ok) {
      const state = await status(worktreePath)
      if (state.ok && state.value.dirty) return { ok: false, error: { kind: 'dirty', root: worktreePath } }
      return removed
    }
  }

  const pruned = await git(root, ['worktree', 'prune'])
  if (!pruned.ok) return pruned

  return { ok: true, value: { path: worktreePath } }
}

export async function gitInput(root: string, args: string[], input: string): Promise<GitResult<string>> {
  return new Promise((resolve) => {
    const options = { cwd: root, maxBuffer: MAX_OUTPUT, windowsHide: true }

    const child = execFile('git', args, options, (error, stdout) => {
      if (!error) return resolve({ ok: true, value: text(stdout) })
      void classify(root, args, error as ExecFailure).then((failure) => resolve({ ok: false, error: failure }))
    })

    child.stdin?.on('error', () => {})
    child.stdin?.end(input)
  })
}

export function endpoint(url: string): { host: string; port: number } | null {
  const scp = /^(?:[^@/]+@)?([^/:]+):(?!\/)/.exec(url)
  const host = scp?.[1]
  if (host !== undefined && host !== '') return { host, port: 22 }

  try {
    const parsed = new URL(url)
    const named = PORTS[parsed.protocol.replace(':', '')]
    const port = parsed.port === '' ? named : Number.parseInt(parsed.port, 10)
    if (parsed.hostname === '' || port === undefined || !Number.isFinite(port)) return null
    return { host: parsed.hostname, port }
  } catch {
    return null
  }
}

function connects(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const settle = (reachable: boolean): void => {
      socket.destroy()
      resolve(reachable)
    }

    socket.setTimeout(CONNECT_MS, () => settle(false))
    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
  })
}

async function remoteRefusal(root: string, remote: string): Promise<GitFailure> {
  const url = await git(root, ['remote', 'get-url', remote])
  const target = url.ok ? endpoint(url.value.trim()) : null
  const reachable = target !== null && (await connects(target.host, target.port))

  return reachable ? { kind: 'auth-failed', remote } : { kind: 'unreachable', remote }
}

async function unreachableOr(root: string, remote: string, fallback: GitFailure): Promise<GitFailure> {
  return (await git(root, ['ls-remote', '--heads', remote])).ok ? fallback : remoteRefusal(root, remote)
}

async function upstreamRemote(root: string, branch: string): Promise<string | null> {
  const out = await git(root, ['config', '--get', `branch.${branch}.remote`])
  const name = out.ok ? out.value.trim() : ''
  return name === '' ? null : name
}

export async function commit(root: string, title: string, description: string): Promise<GitResult<Committed>> {
  const subject = title.trim()
  if (subject === '' || subject.includes('\0')) return { ok: false, error: { kind: 'bad-argument', value: title } }
  if (description.includes('\0')) return { ok: false, error: { kind: 'bad-argument', value: description } }

  const before = await status(root)
  if (!before.ok) return before
  if (before.value.conflicted > 0) return { ok: false, error: { kind: 'conflicted', files: before.value.conflicted } }
  if (before.value.staged === 0) return { ok: false, error: { kind: 'nothing-staged', root } }

  const body = description.trim()
  const message = body === '' ? `${subject}\n` : `${subject}\n\n${body}\n`

  const recorded = await gitInput(root, ['commit', '--cleanup=verbatim', '-F', '-'], message)
  if (!recorded.ok) return recorded

  const oid = await git(root, ['rev-parse', 'HEAD'])
  if (!oid.ok) return oid

  const after = await status(root)
  if (!after.ok) return after

  return {
    ok: true,
    value: { commit: oid.value.trim(), branch: after.value.head.kind === 'branch' ? after.value.head.branch : null },
  }
}

async function whyPushRefused(root: string, remote: string, branch: string, fallback: GitFailure): Promise<GitFailure> {
  const listed = await git(root, ['ls-remote', '--heads', remote, branch])
  if (!listed.ok) return remoteRefusal(root, remote)

  const [sha = ''] = listed.value.trim().split(/\s+/)
  if (sha !== '' && !(await succeeds(root, ['merge-base', '--is-ancestor', sha, 'HEAD']))) {
    return { kind: 'non-fast-forward', branch }
  }

  return fallback
}

export async function push(root: string): Promise<GitResult<Pushed>> {
  const state = await status(root)
  if (!state.ok) return state
  if (state.value.head.kind !== 'branch') return { ok: false, error: { kind: 'detached-head', root } }

  const branch = state.value.head.branch
  if (badArgument(branch)) return { ok: false, error: { kind: 'bad-argument', value: branch } }

  const setUpstream = state.value.upstream === null
  const configured = setUpstream ? null : await upstreamRemote(root, branch)
  const chosen = configured === null ? await remoteName(root) : { ok: true as const, value: configured }
  if (!chosen.ok) return chosen

  const remote = chosen.value
  const args = setUpstream ? ['push', '--set-upstream', remote, branch] : ['push']

  const pushed = await git(root, args)
  if (pushed.ok) return { ok: true, value: { remote, branch, setUpstream } }
  if (pushed.error.kind !== 'failed') return pushed

  return { ok: false, error: await whyPushRefused(root, remote, branch, pushed.error) }
}

export async function pull(root: string): Promise<GitResult<Pulled>> {
  const state = await status(root)
  if (!state.ok) return state
  if (state.value.head.kind !== 'branch') return { ok: false, error: { kind: 'detached-head', root } }

  const branch = state.value.head.branch
  if (state.value.conflicted > 0) return { ok: false, error: { kind: 'conflicted', files: state.value.conflicted } }
  if (state.value.upstream === null) return { ok: false, error: { kind: 'no-upstream', branch } }

  const remote = await upstreamRemote(root, branch)
  if (remote === null) return { ok: false, error: { kind: 'no-upstream', branch } }

  const before = await git(root, ['rev-parse', 'HEAD'])
  if (!before.ok) return before

  const pulled = await git(root, ['pull', '--ff-only'])
  if (pulled.ok) {
    const after = await git(root, ['rev-parse', 'HEAD'])
    if (!after.ok) return after
    return { ok: true, value: { remote, branch, changed: before.value.trim() !== after.value.trim() } }
  }
  if (pulled.error.kind !== 'failed') return pulled

  const reached = await unreachableOr(root, remote, pulled.error)
  if (reached.kind !== 'failed') return { ok: false, error: reached }

  const after = await status(root)
  if (!after.ok) return { ok: false, error: pulled.error }

  if (after.value.ahead > 0 && after.value.behind > 0) {
    return { ok: false, error: { kind: 'diverged', ahead: after.value.ahead, behind: after.value.behind } }
  }

  return { ok: false, error: after.value.dirty ? { kind: 'dirty', root } : pulled.error }
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
