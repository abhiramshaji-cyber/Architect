import type { ChangeStatus } from '../../../shared/types'

const STATUS: Record<string, ChangeStatus> = {
  A: 'added',
  C: 'copied',
  D: 'deleted',
  M: 'modified',
  R: 'renamed',
  T: 'typechanged',
  U: 'unmerged',
}

export type Named = { path: string; from: string | null; status: ChangeStatus; similarity: number | null }

export type Counted = { added: number | null; removed: number | null; binary: boolean }

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
