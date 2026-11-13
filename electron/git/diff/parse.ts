import type { ChangedFile, ChangeStatus } from '../../../shared/types'
import { parseNumstat } from '../churn/numstat'

const STATUS: Record<string, ChangeStatus> = {
  A: 'added',
  C: 'copied',
  D: 'deleted',
  M: 'modified',
  R: 'renamed',
  T: 'typechanged',
  U: 'unmerged',
}

type Named = Pick<ChangedFile, 'path' | 'from' | 'status' | 'similarity'>

export function parseChanges(stdout: string): ChangedFile[] {
  const fields = stdout.split('\0')
  const named: Named[] = []

  let i = 0
  while (fields[i]?.startsWith(':')) {
    const code = fields[i]?.split(' ').at(-1) ?? ''
    const letter = code.slice(0, 1)
    const score = Number.parseInt(code.slice(1), 10)
    const paired = letter === 'R' || letter === 'C'
    const from = paired ? (fields[i + 1] ?? '') : null
    const path = fields[i + (paired ? 2 : 1)] ?? ''
    i += paired ? 3 : 2

    if (path === '') continue
    named.push({ path, from, status: STATUS[letter] ?? 'modified', similarity: Number.isFinite(score) ? score : null })
  }

  const counted = new Map(parseNumstat(fields.slice(i).join('\0')).flatMap((commit) => commit.files.map((file) => [file.path, file] as const)))
  return named.map((entry) => {
    const file = counted.get(entry.path)
    const known = file !== undefined && !file.binary
    return { ...entry, added: known ? file.added : null, removed: known ? file.removed : null, binary: file?.binary ?? false }
  })
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
