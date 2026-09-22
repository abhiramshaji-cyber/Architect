import type { CodeMap } from '../../shared/types'
import { fileIndex, fnNodeId } from './codemap'

export type OutlineEntry = { id: string; name: string; line: number; endLine: number }

export function outlineFor(map: CodeMap | null | undefined, path: string): OutlineEntry[] {
  const file = map ? fileIndex(map).get(path) : undefined
  if (!file) return []

  return file.functions
    .map((fn, i) => ({ id: fnNodeId(path, i, fn.name), name: fn.name, line: fn.line, endLine: fn.endLine }))
    .sort((a, b) => a.line - b.line)
}
