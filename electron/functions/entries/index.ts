import fs from 'node:fs'
import path from 'node:path'
import type { CodeMap, EntryReason } from '../../../shared/types'
import { builtIn, type Built } from './build'
import { compiledFrom } from './compiled'
import { declaredIn, type Declared } from './manifest'

export type EntryFiles = Map<string, EntryReason[]> & { opaque?: string[] }

const CODE = /\.[cm]?[jt]sx?$/

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
    const hits = matching(path.posix.join(dir, file), files)
    for (const hit of hits) {
      const reasons = into.get(hit) ?? []
      if (!reasons.includes(reason)) into.set(hit, [...reasons, reason])
    }
    return hits.length
  }

  const mapped = new Map<string, boolean>()
  for (const entry of built) if (entry.reason !== null) add(entry.file, entry.reason)
  for (const declared of declaredIn(manifest)) {
    const found = sourcesOf(declared, built, compiled).reduce((sum, file) => sum + add(file, declared.reason), 0)
    const code = CODE.test(declared.file) && !/\.d\.[cm]?ts$/.test(declared.file)
    if (declared.subpath !== undefined && code) mapped.set(declared.subpath, (mapped.get(declared.subpath) ?? false) || found > 0)
  }
  if ([...mapped.values()].includes(false)) into.opaque = [...new Set([...(into.opaque ?? []), dir])]
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
