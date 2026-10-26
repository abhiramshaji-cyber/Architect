import type { BranchPatch, ChangedFile, DiffChanges, GitResult } from '../../../shared/types'
import { defaultBranch, git, gitInput, parseStatus, succeeds } from '../git'
import { parseNameStatus, parseNumstat, parseUntracked, type Counted, type Named } from './parse'

export const LIST = ['diff', '-z', '-M', '-C', '--no-color']
export const PATCH = ['diff', '-U3', '-M', '-C', '--no-color']
const STATE = ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z']

function merge(named: Named[], counted: Map<string, Counted>): ChangedFile[] {
  return named.map((entry) => ({
    ...entry,
    ...(counted.get(entry.path) ?? {
      added: null,
      removed: null,
      binary: false,
    }),
  }))
}

async function listed(root: string, args: string[]): Promise<GitResult<ChangedFile[]>> {
  const [named, counted] = await Promise.all([git(root, [...args, '--name-status']), git(root, [...args, '--numstat'])])
  if (!named.ok) return named
  if (!counted.ok) return counted

  return {
    ok: true,
    value: merge(parseNameStatus(named.value), parseNumstat(counted.value)),
  }
}

function untrackedFiles(paths: string[]): ChangedFile[] {
  return paths.map((path) => ({
    path,
    from: null,
    status: 'untracked' as const,
    similarity: null,
    added: null,
    removed: null,
    binary: false,
  }))
}

export async function toplevel(root: string): Promise<GitResult<string>> {
  const out = await git(root, ['rev-parse', '--show-toplevel'])
  return out.ok ? { ok: true, value: out.value.trim() } : out
}

export async function localBase(root: string): Promise<GitResult<string>> {
  if (await succeeds(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])) return { ok: true, value: 'HEAD' }

  const empty = await gitInput(root, ['hash-object', '-t', 'tree', '--stdin'], '')
  return empty.ok ? { ok: true, value: empty.value.trim() } : empty
}

export async function mergeBase(root: string): Promise<GitResult<string>> {
  const base = await defaultBranch(root)
  if (!base.ok) return base

  const ref = `${base.value.remote}/${base.value.branch}`
  if (!(await succeeds(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]))) {
    return { ok: false, error: { kind: 'bad-ref', ref } }
  }

  const out = await git(root, ['merge-base', ref, 'HEAD'])
  if (!out.ok) return out

  const oid = out.value.trim()
  return oid === '' ? { ok: false, error: { kind: 'bad-ref', ref } } : { ok: true, value: oid }
}

async function aheadOf(root: string, base: GitResult<string>): Promise<number> {
  if (!base.ok) return 0
  const out = await git(root, ['rev-list', '--count', `${base.value}..HEAD`])
  return out.ok ? Number.parseInt(out.value.trim(), 10) || 0 : 0
}

export async function changes(root: string): Promise<GitResult<DiffChanges>> {
  const state = await git(root, STATE)
  if (!state.ok) return state

  const untracked = untrackedFiles(parseUntracked(state.value))

  const [base, from, staged, unstaged, prefix] = await Promise.all([
    mergeBase(root),
    localBase(root),
    listed(root, [...LIST, '--cached']),
    listed(root, LIST),
    git(root, ['rev-parse', '--show-prefix']),
  ])

  const [branch, local, commits] = await Promise.all([
    base.ok ? listed(root, [...LIST, base.value, 'HEAD']) : base,
    from.ok ? listed(root, [...LIST, from.value]) : from,
    aheadOf(root, base),
  ])

  return {
    ok: true,
    value: {
      status: parseStatus(state.value),
      prefix: prefix.ok ? prefix.value.trim() : '',
      base,
      commits,
      branch,
      local: local.ok ? { ok: true, value: [...local.value, ...untracked] } : local,
      staged,
      unstaged: unstaged.ok ? { ok: true, value: [...unstaged.value, ...untracked] } : unstaged,
    },
  }
}

export async function stagedPatch(root: string): Promise<GitResult<string>> {
  return git(root, [...PATCH, '--cached'])
}

export async function stageAll(root: string): Promise<GitResult<string>> {
  return git(root, ['add', '--all', '--', ':/'])
}

export async function branchPatch(root: string): Promise<GitResult<BranchPatch>> {
  const base = await defaultBranch(root)
  if (!base.ok) return base

  const state = await git(root, STATE)
  if (!state.ok) return state

  const head = parseStatus(state.value).head
  if (head.kind !== 'branch') return { ok: false, error: { kind: 'detached-head', root } }

  const ref = `${base.value.remote}/${base.value.branch}`
  const range = `${ref}...HEAD`

  const counted = await git(root, ['rev-list', '--count', `${ref}..HEAD`])
  if (!counted.ok) return counted

  const log = await git(root, ['log', '--no-color', '--format=%s%n%n%b', `${ref}..HEAD`])
  if (!log.ok) return log

  const patch = await git(root, [...PATCH, range])
  if (!patch.ok) return patch

  return {
    ok: true,
    value: {
      base: base.value.branch,
      branch: head.branch,
      commits: Number.parseInt(counted.value.trim(), 10) || 0,
      log: log.value,
      patch: patch.value,
    },
  }
}
