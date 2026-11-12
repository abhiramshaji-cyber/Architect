import fs from 'node:fs'
import path from 'node:path'
import type { CodeMap, EntryReason } from '../../../shared/types'
import { builtIn, type Built } from './build'
import { compiledFrom } from './compiled'
import { declaredIn, type Declared } from './manifest'

export type EntryFiles = Map<string, EntryReason[]>

function manifestOf(root: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

const stem = (file: string) => path.posix.basename(file, path.posix.extname(file))

function sourcesOf(declared: Declared, built: Built[], compiled: (file: string) => string[]): string[] {
  const dir = path.posix.dirname(declared.file)
  const outputs = built.filter((entry) => path.posix.normalize(entry.outDir) === dir)
  const named = outputs.filter((entry) => stem(entry.name ?? entry.file) === stem(declared.file))
  const only = outputs.length === 1 ? outputs : []
  return [declared.file, ...(named.length > 0 ? named : only).map((entry) => entry.file), ...compiled(declared.file)]
}

export function entriesIn(root: string, files: Set<string>, manifest: unknown): EntryFiles {
  const built = builtIn(root)
  const compiled = compiledFrom(root)
  const entries: EntryFiles = new Map()
  const add = (file: string, reason: EntryReason) => {
    if (!files.has(file)) return
    const reasons = entries.get(file) ?? []
    if (!reasons.includes(reason)) entries.set(file, [...reasons, reason])
  }

  for (const entry of built) if (entry.reason !== null) add(entry.file, entry.reason)
  for (const declared of declaredIn(manifest)) {
    for (const file of sourcesOf(declared, built, compiled)) add(file, declared.reason)
  }
  return entries
}

export function entryFiles(root: string, map: CodeMap): EntryFiles {
  const files = new Set(map.folders.flatMap((folder) => folder.files.map((file) => file.path)))
  return entriesIn(root, files, manifestOf(root))
}
