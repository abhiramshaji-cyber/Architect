import fs from 'node:fs'
import path from 'node:path'
import type { CodeMap, EntryReason } from '../../../shared/types'
import { builtIn, type Built } from './build'
import { compiledFrom } from './compiled'
import { declaredIn, type Declared } from './manifest'

export type EntryFiles = Map<string, EntryReason[]>

function manifestOf(dir: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
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

function matching(pattern: string, files: Set<string>): string[] {
  if (!pattern.includes('*')) return files.has(pattern) ? [pattern] : []
  const parts = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
  const test = new RegExp(`^${parts.join('.+')}$`)
  return [...files].filter((file) => test.test(file))
}

export function entriesIn(root: string, files: Set<string>, manifest: unknown, dir = '', into: EntryFiles = new Map()): EntryFiles {
  const base = path.join(root, dir)
  const built = builtIn(base)
  const compiled = compiledFrom(base)
  const add = (file: string, reason: EntryReason) => {
    for (const hit of matching(path.posix.join(dir, file), files)) {
      const reasons = into.get(hit) ?? []
      if (!reasons.includes(reason)) into.set(hit, [...reasons, reason])
    }
  }

  for (const entry of built) if (entry.reason !== null) add(entry.file, entry.reason)
  for (const declared of declaredIn(manifest)) {
    for (const file of sourcesOf(declared, built, compiled)) add(file, declared.reason)
  }
  return into
}

export function entryFiles(root: string, map: CodeMap): EntryFiles {
  const files = new Set(map.folders.flatMap((folder) => folder.files.map((file) => file.path)))
  const packages = [...files].filter((file) => path.posix.basename(file) === 'package.json').map(path.posix.dirname)
  const into: EntryFiles = new Map()
  for (const dir of new Set(['.', ...packages])) {
    const at = dir === '.' ? '' : dir
    entriesIn(root, files, manifestOf(path.join(root, at)), at, into)
  }
  return into
}
