import path from 'node:path'
import type { CodeChange } from '../../shared/types'
import { within } from '../git/session'

function replaced(text: string, old: string, next: string, all: boolean): string | null {
  if (old === '') return text === '' ? next : null

  const first = text.indexOf(old)
  if (first === -1) return null
  if (all) return text.split(old).join(next)
  if (text.indexOf(old, first + old.length) !== -1) return null
  return text.slice(0, first) + next + text.slice(first + old.length)
}

export function applyChange(before: string, change: CodeChange): string | null {
  if (change.tool === 'Write') return change.content

  let text: string | null = before
  for (const edit of change.edits) {
    text = replaced(text, edit.old, edit.new, edit.all)
    if (text === null) return null
  }
  return text
}

export type Place = { root: string; file: string; relative: string }

export function rootOf(aliases: Map<string, string>, files: string[]): Place | null {
  let best: (Place & { alias: string }) | null = null
  for (const [alias, root] of aliases) {
    for (const file of files) {
      if (file === alias || !within(alias, file)) continue
      if (best && best.alias.length >= alias.length) continue
      best = { alias, root, file, relative: path.relative(alias, file).split(path.sep).join('/') }
    }
  }
  return best && { root: best.root, file: best.file, relative: best.relative }
}
