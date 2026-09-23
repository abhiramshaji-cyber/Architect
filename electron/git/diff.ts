import fs from 'node:fs/promises'
import parseDiff from 'parse-diff'
import {
  MAX_DIFF_BYTES,
  type ChangeStatus,
  type ChangedFile,
  type DiffChanges,
  type DiffHunk,
  type DiffRow,
  type DiffSection,
  type DiffSide,
  type FileDiff,
  type GitResult,
} from '../../shared/types'
import { defaultBranch, git, parseStatus, succeeds } from './git'

const STATUS: Record<string, ChangeStatus> = {
  A: 'added',
  C: 'copied',
  D: 'deleted',
  M: 'modified',
  R: 'renamed',
  T: 'typechanged',
  U: 'unmerged',
}

type Named = { path: string; from: string | null; status: ChangeStatus; similarity: number | null }

type Counted = { added: number | null; removed: number | null; binary: boolean }

function badPath(value: string): boolean {
  return value === '' || value.includes('\0')
}

function records(stdout: string): string[] {
  return stdout.split('\0').filter((field) => field !== '')
}

export function parseNameStatus(stdout: string): Named[] {
  const fields = records(stdout)
  const found: Named[] = []

  let i = 0
  while (i < fields.length) {
    const code = fields[i] ?? ''
    const letter = code.slice(0, 1)
    const score = Number.parseInt(code.slice(1), 10)
    const paired = letter === 'R' || letter === 'C'
    const from = paired ? (fields[i + 1] ?? '') : null
    const path = fields[i + (paired ? 2 : 1)] ?? ''
    i += paired ? 3 : 2

    if (path === '') continue
    found.push({ path, from, status: STATUS[letter] ?? 'modified', similarity: Number.isFinite(score) ? score : null })
  }

  return found
}

export function parseNumstat(stdout: string): Map<string, Counted> {
  const fields = records(stdout)
  const found = new Map<string, Counted>()

  let i = 0
  while (i < fields.length) {
    const field = fields[i] ?? ''
    const tab = field.indexOf('\t')
    const nextTab = field.indexOf('\t', tab + 1)
    if (tab === -1 || nextTab === -1) {
      i += 1
      continue
    }

    const added = field.slice(0, tab)
    const removed = field.slice(tab + 1, nextTab)
    const inline = field.slice(nextTab + 1)
    const paired = inline === ''
    const path = paired ? (fields[i + 2] ?? '') : inline
    i += paired ? 3 : 1

    if (path === '') continue
    const binary = added === '-' && removed === '-'
    found.set(path, {
      added: binary ? null : Number.parseInt(added, 10) || 0,
      removed: binary ? null : Number.parseInt(removed, 10) || 0,
      binary,
    })
  }

  return found
}

function merge(named: Named[], counted: Map<string, Counted>): ChangedFile[] {
  return named.map((entry) => ({
    ...entry,
    ...(counted.get(entry.path) ?? { added: null, removed: null, binary: false }),
  }))
}

async function listed(root: string, args: string[]): Promise<GitResult<ChangedFile[]>> {
  const [named, counted] = await Promise.all([
    git(root, [...args, '--name-status']),
    git(root, [...args, '--numstat']),
  ])
  if (!named.ok) return named
  if (!counted.ok) return counted

  return { ok: true, value: merge(parseNameStatus(named.value), parseNumstat(counted.value)) }
}

const LIST = ['diff', '-z', '-M', '-C', '--no-color']
const PATCH = ['diff', '-U3', '-M', '-C', '--no-color']
const STATE = ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z']

export function parseUntracked(stdout: string): string[] {
  const fields = stdout.split('\0')
  const found: string[] = []

  let i = 0
  while (i < fields.length) {
    const field = fields[i] ?? ''
    i += 1
    if (field.startsWith('2 ')) i += 1
    else if (field.startsWith('? ')) found.push(field.slice(2))
  }

  return found
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

export async function changes(root: string): Promise<GitResult<DiffChanges>> {
  const state = await git(root, STATE)
  if (!state.ok) return state

  const untracked = untrackedFiles(parseUntracked(state.value))

  const [base, staged, unstaged] = await Promise.all([
    mergeBase(root),
    listed(root, [...LIST, '--cached']),
    listed(root, LIST),
  ])

  const branch = base.ok ? await listed(root, [...LIST, base.value, 'HEAD']) : base

  return {
    ok: true,
    value: {
      status: parseStatus(state.value),
      base,
      branch,
      staged,
      unstaged: unstaged.ok ? { ok: true, value: [...unstaged.value, ...untracked] } : unstaged,
    },
  }
}

function side(line: number, content: string): DiffSide {
  return { line, text: content.slice(1), noNewline: false }
}

function markNoNewline(rows: DiffRow[], dels: DiffSide[], adds: DiffSide[], type: parseDiff.ChangeType): void {
  const last = rows[rows.length - 1]

  if (type === 'del') {
    const target = dels[dels.length - 1] ?? last?.old
    if (target) target.noNewline = true
    return
  }

  if (type === 'add') {
    const target = adds[adds.length - 1] ?? last?.new
    if (target) target.noNewline = true
    return
  }

  if (last?.old) last.old.noNewline = true
  if (last?.new) last.new.noNewline = true
}

export function alignChanges(changes: parseDiff.Change[]): DiffRow[] {
  const rows: DiffRow[] = []
  let dels: DiffSide[] = []
  let adds: DiffSide[] = []

  function flush(): void {
    const span = Math.max(dels.length, adds.length)
    for (let i = 0; i < span; i += 1) rows.push({ old: dels[i] ?? null, new: adds[i] ?? null, context: false })
    dels = []
    adds = []
  }

  for (const change of changes) {
    if (change.content.startsWith('\\')) {
      markNoNewline(rows, dels, adds, change.type)
      continue
    }

    if (change.type === 'normal') {
      flush()
      rows.push({ old: side(change.ln1, change.content), new: side(change.ln2, change.content), context: true })
      continue
    }

    if (change.type === 'del') {
      if (adds.length > 0) flush()
      dels.push(side(change.ln, change.content))
      continue
    }

    adds.push(side(change.ln, change.content))
  }

  flush()
  return rows
}

export function toHunks(patch: string): DiffHunk[] {
  return parseDiff(patch).flatMap((file) =>
    file.chunks.map((chunk) => ({
      header: chunk.content,
      oldStart: chunk.oldStart,
      oldLines: chunk.oldLines,
      newStart: chunk.newStart,
      newLines: chunk.newLines,
      rows: alignChanges(chunk.changes),
    })),
  )
}

function addedPatch(text: string): DiffHunk[] {
  const lines = text.split('\n')
  const trailing = lines[lines.length - 1] === ''
  const body = trailing ? lines.slice(0, -1) : lines
  if (body.length === 0) return []

  const rows: DiffRow[] = body.map((line, index) => ({
    old: null,
    new: { line: index + 1, text: line.replace(/\r$/, ''), noNewline: !trailing && index === body.length - 1 },
    context: false,
  }))

  return [{ header: `@@ -0,0 +1,${body.length} @@`, oldStart: 0, oldLines: 0, newStart: 1, newLines: body.length, rows }]
}

async function untrackedDiff(root: string, file: ChangedFile, full: boolean): Promise<GitResult<FileDiff>> {
  const whole = `${root}/${file.path}`
  const size = await fs.stat(whole).then((stat) => stat.size, () => null)
  if (size === null) return { ok: false, error: { kind: 'failed', args: ['stat', file.path], code: null, stderr: '' } }

  const shell = { path: file.path, from: null, bytes: size }
  if (size > MAX_DIFF_BYTES && !full) return { ok: true, value: { ...shell, binary: false, oversize: true, hunks: [] } }

  const bytes = await fs.readFile(whole).catch(() => null)
  if (bytes === null) return { ok: false, error: { kind: 'failed', args: ['read', file.path], code: null, stderr: '' } }

  const binary = bytes.subarray(0, 8000).includes(0)
  return {
    ok: true,
    value: { ...shell, binary, oversize: false, hunks: binary ? [] : addedPatch(bytes.toString('utf8')) },
  }
}

const RANGE: Record<DiffSection, (base: string) => string[]> = {
  branch: (base) => [base, 'HEAD'],
  staged: () => ['--cached'],
  unstaged: () => [],
}

export async function fileDiff(
  root: string,
  section: DiffSection,
  file: ChangedFile,
  full = false,
): Promise<GitResult<FileDiff>> {
  for (const value of [file.path, file.from ?? file.path]) {
    if (badPath(value)) return { ok: false, error: { kind: 'bad-argument', value } }
  }

  if (file.status === 'untracked') return untrackedDiff(root, file, full)

  const shell = { path: file.path, from: file.from, binary: file.binary, bytes: 0, oversize: false }
  if (file.binary) return { ok: true, value: { ...shell, hunks: [] } }

  const base = section === 'branch' ? await mergeBase(root) : { ok: true as const, value: '' }
  if (!base.ok) return base

  const paths = file.from === null || file.from === file.path ? [file.path] : [file.from, file.path]
  const out = await git(root, [...PATCH, ...RANGE[section](base.value), '--', ...paths])
  if (!out.ok) return out

  const bytes = Buffer.byteLength(out.value, 'utf8')
  const oversize = bytes > MAX_DIFF_BYTES && !full

  return { ok: true, value: { ...shell, bytes, oversize, hunks: oversize ? [] : toHunks(out.value) } }
}

async function pathArgs(file: ChangedFile): Promise<GitResult<string[]>> {
  for (const value of [file.path, file.from ?? file.path]) {
    if (badPath(value)) return { ok: false, error: { kind: 'bad-argument', value } }
  }

  return { ok: true, value: file.from === null || file.from === file.path ? [file.path] : [file.from, file.path] }
}

export async function stageFile(root: string, file: ChangedFile): Promise<GitResult<{ path: string }>> {
  const paths = await pathArgs(file)
  if (!paths.ok) return paths

  const added = await git(root, ['add', '--all', '--', ...paths.value])
  return added.ok ? { ok: true, value: { path: file.path } } : added
}

export async function unstageFile(root: string, file: ChangedFile): Promise<GitResult<{ path: string }>> {
  const paths = await pathArgs(file)
  if (!paths.ok) return paths

  const born = await succeeds(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  const out = born
    ? await git(root, ['restore', '--staged', '--', ...paths.value])
    : await git(root, ['rm', '--cached', '-q', '--', ...paths.value])

  return out.ok ? { ok: true, value: { path: file.path } } : out
}
