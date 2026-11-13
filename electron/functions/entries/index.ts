import fs from 'node:fs'
import path from 'node:path'
import type { CodeMap, EntryReason } from '../../../shared/types'
import { builtIn, type Built } from './build'
import { compiledFrom } from './compiled'
import { declaredIn, type Declared } from './manifest'

export type EntryFiles = Map<string, EntryReason[]> & { opaque?: string[]; packages?: string[] }

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

const weightOf = (subpath = '') => (subpath.includes('*') ? subpath.indexOf('*') : Infinity)

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
  const declared = declaredIn(manifest)
  const hidden = new Map<string, number>()
  for (const one of declared.filter((each) => each.excluded)) {
    for (const file of sourcesOf(one, built, compiled).flatMap((source) => matching(path.posix.join(dir, source), files))) {
      hidden.set(file, Math.max(hidden.get(file) ?? -1, weightOf(one.subpath)))
    }
  }
  const add = (file: string, reason: EntryReason, subpath?: string) => {
    const shown = (hit: string) => reason !== 'exports' || !subpath?.includes('*') || weightOf(subpath) > (hidden.get(hit) ?? -1)
    const exact = reason === 'script' || reason === 'bin'
    const hits = (exact ? [path.posix.join(dir, file)].filter((one) => files.has(one)) : matching(path.posix.join(dir, file), files)).filter(shown)
    for (const hit of hits) {
      const reasons = into.get(hit) ?? []
      if (!reasons.includes(reason)) into.set(hit, [...reasons, reason])
    }
    return hits.length
  }

  const mapped = new Map<string, boolean>()
  for (const entry of built) if (entry.reason !== null) add(entry.file, entry.reason)
  for (const one of declared.filter((each) => !each.excluded)) {
    const found = sourcesOf(one, built, compiled).reduce((sum, file) => sum + add(file, one.reason, one.subpath), 0)
    const code = CODE.test(one.file) && !/\.d\.[cm]?ts$/.test(one.file)
    if (one.subpath !== undefined && code) mapped.set(one.subpath, (mapped.get(one.subpath) ?? false) || found > 0)
  }
  if ([...mapped.values()].includes(false)) into.opaque = [...new Set([...(into.opaque ?? []), dir])]
  return into
}

export function entryFiles(root: string, map: CodeMap): EntryFiles {
  const files = new Set(map.folders.flatMap((folder) => folder.files.map((file) => file.path)))
  const packages = [...files].filter((file) => path.posix.basename(file) === 'package.json').map(path.posix.dirname)
  const into: EntryFiles = new Map()
  into.packages = [...new Set(['', ...packages.map((dir) => (dir === '.' ? '' : dir))])]
  for (const at of into.packages) entriesIn(root, files, manifestOf(path.join(root, at)), at, into)
  return into
}
