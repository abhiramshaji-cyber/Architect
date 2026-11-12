import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { CallRef, FileStart, FunctionEntry } from '../../../shared/types'
import { starred } from './exports'
import { placeSites, type Raw } from './sites'
import { globbed } from './glob'
import { spreadOf } from './spread'

export type { Raw } from './sites'

export type Pending = { from: number; spec: string; key: string }

export type Parsed = {
  functions: FunctionEntry[]
  starts: FileStart[]
  topLevel: Map<string, number>
  exports: Map<string, string>
  reexports: Map<string, { spec: string; name: string }>
  stars: string[]
  pending: Pending[]
  raw: Map<number, Raw[]>
  specs: Set<string>
}

function resolutionOptions(root: string): ts.CompilerOptions {
  const options: ts.CompilerOptions = {
    allowJs: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  }

  const config = path.join(root, 'tsconfig.json')
  try {
    const read = ts.readConfigFile(config, ts.sys.readFile)
    if (read.error !== undefined || typeof read.config !== 'object' || read.config === null) return options
    const parsed = ts.parseJsonConfigFileContent({ ...read.config, files: [], include: [] }, ts.sys, root)
    return { ...options, baseUrl: parsed.options.baseUrl, paths: parsed.options.paths }
  } catch {
    return options
  }
}

function realRoot(root: string): string {
  try {
    return fs.realpathSync(root)
  } catch {
    return root
  }
}

export function link(root: string, parsed: Map<string, Parsed>): Map<string, string[]> {
  const options = resolutionOptions(root)
  const cache = ts.createModuleResolutionCache(root, (name) => name, options)
  const bases = [...new Set([root, realRoot(root)])]

  const target = (from: string, spec: string): string | undefined => {
    const hit = ts.resolveModuleName(spec, path.join(root, from), options, ts.sys, cache).resolvedModule
    if (hit === undefined || hit.isExternalLibraryImport === true) return undefined

    for (const base of bases) {
      const relative = path.relative(base, hit.resolvedFileName).split(path.sep).join('/')
      if (parsed.has(relative)) return relative
    }

    return undefined
  }

  const find = (file: string, key: string, seen: Set<string>): CallRef | undefined => {
    const at = parsed.get(file)
    if (at === undefined || key === '') return undefined

    const mark = `${file}\0${key}`
    if (seen.has(mark)) return undefined
    seen.add(mark)

    for (let cut = key.length; cut > 0; cut = key.lastIndexOf('.', cut - 1)) {
      const prefix = key.slice(0, cut)
      const rest = key.slice(cut)

      const local = at.exports.get(prefix)
      const fn = local === undefined ? undefined : at.topLevel.get(local + rest)
      if (fn !== undefined) return { file, fn }

      const via = at.reexports.get(prefix)
      const to = via === undefined ? undefined : target(file, via.spec)
      const hit =
        via === undefined || to === undefined ? undefined : find(to, via.name === '*' ? rest.slice(1) : via.name + rest, seen)
      if (hit !== undefined) return hit
    }

    for (const spec of at.stars) {
      const to = target(file, spec)
      const hit = to === undefined ? undefined : find(to, key, seen)
      if (hit !== undefined) return hit
    }

    return undefined
  }

  const spread = spreadOf(parsed, target)
  for (const [file, at] of parsed) {
    for (const { from, spec, key } of at.pending) {
      const entry = at.functions[from] ?? at.starts[from - at.functions.length]
      if (entry === undefined) continue
      const spreads = 'kind' in entry && (entry.kind === 'value' || entry.kind === 'exports')
      const targets = spec.includes('*') ? globbed(file, spec, [...parsed.keys()]) : [target(file, spec)]
      for (const to of targets) {
        if (to === undefined) continue
        const exact = find(to, key, new Set())
        const hits = exact !== undefined ? [exact] : spreads ? spread(to, key) : []
        for (const hit of hits) if (!entry.calls.some((c) => c.file === hit.file && c.fn === hit.fn)) entry.calls.push(hit)
      }
    }

    for (const entry of at.functions) {
      entry.calls.sort((a, b) => a.file.localeCompare(b.file) || a.fn - b.fn)
    }
  }

  for (const [file, at] of parsed) {
    placeSites(at, (spec, key) => {
      const to = target(file, spec)
      return to === undefined ? undefined : find(to, key, new Set())
    })
  }

  starred(parsed, target)

  const imports = new Map<string, string[]>()
  for (const [file, at] of parsed) {
    const resolved = [...at.specs].map((spec) => target(file, spec)).filter((to) => to !== undefined && to !== file)
    imports.set(file, [...new Set(resolved as string[])].sort())
  }
  return imports
}
