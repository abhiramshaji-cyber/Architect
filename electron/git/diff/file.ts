import fs from 'node:fs/promises'
import path from 'node:path'
import {
  MAX_DIFF_BYTES,
  type ChangedFile,
  type DiffSection,
  type FileDiff,
  type GitResult,
} from '../../../shared/types'
import { git, succeeds } from '../git'
import { localBase, mergeBase, PATCH, toplevel } from './changes'
import { addedPatch, toHunks } from './hunks'

const LITERAL = '--literal-pathspecs'

function badPath(value: string): boolean {
  return value === '' || value.includes('\0')
}

function pathArgs(file: ChangedFile): GitResult<string[]> {
  for (const value of [file.path, file.from ?? file.path]) {
    if (badPath(value)) return { ok: false, error: { kind: 'bad-argument', value } }
  }

  return {
    ok: true,
    value: file.from === null || file.from === file.path ? [file.path] : [file.from, file.path],
  }
}

function unreadable(step: string, file: ChangedFile, error: unknown): GitResult<never> {
  const stderr = error instanceof Error ? error.message : String(error)
  return {
    ok: false,
    error: { kind: 'failed', args: [step, file.path], code: null, stderr },
  }
}

async function untrackedDiff(top: string, file: ChangedFile, full: boolean): Promise<GitResult<FileDiff>> {
  const whole = path.join(top, file.path)

  let size: number
  try {
    size = (await fs.stat(whole)).size
  } catch (error) {
    return unreadable('stat', file, error)
  }

  const shell = { path: file.path, from: null, bytes: size }
  if (size > MAX_DIFF_BYTES && !full)
    return {
      ok: true,
      value: { ...shell, binary: false, oversize: true, hunks: [] },
    }

  let bytes: Buffer
  try {
    bytes = await fs.readFile(whole)
  } catch (error) {
    return unreadable('read', file, error)
  }

  const binary = bytes.subarray(0, 8000).includes(0)
  return {
    ok: true,
    value: {
      ...shell,
      binary,
      oversize: false,
      hunks: binary ? [] : addedPatch(bytes.toString('utf8')),
    },
  }
}

async function rangeFor(root: string, section: DiffSection): Promise<GitResult<string[]>> {
  if (section === 'staged') return { ok: true, value: ['--cached'] }
  if (section === 'unstaged') return { ok: true, value: [] }

  const base = section === 'branch' ? await mergeBase(root) : await localBase(root)
  if (!base.ok) return base
  return {
    ok: true,
    value: section === 'branch' ? [base.value, 'HEAD'] : [base.value],
  }
}

export async function fileDiff(
  root: string,
  section: DiffSection,
  file: ChangedFile,
  full = false,
): Promise<GitResult<FileDiff>> {
  const paths = pathArgs(file)
  if (!paths.ok) return paths

  const top = await toplevel(root)
  if (!top.ok) return top

  if (file.status === 'untracked') return untrackedDiff(top.value, file, full)

  const shell = {
    path: file.path,
    from: file.from,
    binary: file.binary,
    bytes: 0,
    oversize: false,
  }
  if (file.binary) return { ok: true, value: { ...shell, hunks: [] } }

  const range = await rangeFor(root, section)
  if (!range.ok) return range

  const out = await git(top.value, [LITERAL, ...PATCH, ...range.value, '--', ...paths.value])
  if (!out.ok) return out

  const bytes = Buffer.byteLength(out.value, 'utf8')
  const oversize = bytes > MAX_DIFF_BYTES && !full

  return {
    ok: true,
    value: {
      ...shell,
      bytes,
      oversize,
      hunks: oversize ? [] : toHunks(out.value),
    },
  }
}

export async function stageFile(root: string, file: ChangedFile): Promise<GitResult<{ path: string }>> {
  const paths = pathArgs(file)
  if (!paths.ok) return paths

  const top = await toplevel(root)
  if (!top.ok) return top

  const added = await git(top.value, [LITERAL, 'add', '--all', '--', ...paths.value])
  return added.ok ? { ok: true, value: { path: file.path } } : added
}

export async function unstageFile(root: string, file: ChangedFile): Promise<GitResult<{ path: string }>> {
  const paths = pathArgs(file)
  if (!paths.ok) return paths

  const top = await toplevel(root)
  if (!top.ok) return top

  const born = await succeeds(top.value, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  const out = born
    ? await git(top.value, [LITERAL, 'restore', '--staged', '--', ...paths.value])
    : await git(top.value, [LITERAL, 'rm', '--cached', '-q', '--', ...paths.value])

  return out.ok ? { ok: true, value: { path: file.path } } : out
}
