import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

export type Declared = { reason: 'main' | 'bin'; file: string }

const EMITTED: Record<string, string[]> = {
  '.js': ['.ts', '.tsx', '.js', '.jsx'],
  '.mjs': ['.mts', '.mjs'],
  '.cjs': ['.cts', '.cjs'],
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = path.posix.normalize(value.trim().replace(/^\.\//, ''))
  return trimmed === '' || trimmed === '.' || trimmed.startsWith('../') ? null : trimmed
}

export function declaredIn(manifest: unknown): Declared[] {
  if (typeof manifest !== 'object' || manifest === null) return []
  const { main, bin } = manifest as { main?: unknown; bin?: unknown }
  const bins = typeof bin === 'object' && bin !== null ? Object.values(bin) : [bin]
  return [
    ...[main].map((file) => ({ reason: 'main' as const, file: clean(file) })),
    ...bins.map((file) => ({ reason: 'bin' as const, file: clean(file) })),
  ].flatMap(({ reason, file }) => (file === null ? [] : [{ reason, file }]))
}

export function manifestOf(root: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

function commonDir(files: string[]): string {
  const parts = files.map((file) => path.posix.dirname(file).split('/'))
  const first = parts[0] ?? []
  let at = 0
  while (at < first.length && parts.every((p) => p[at] === first[at])) at++
  return first.slice(0, at).join('/') || '.'
}

export function compiledFrom(root: string): (file: string) => string[] {
  try {
    const read = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
    if (read.error !== undefined) return () => []
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root)
    const outDir = parsed.options.outDir
    if (outDir === undefined) return () => []
    const out = path.relative(root, outDir).split(path.sep).join('/')
    const inputs = parsed.fileNames
      .filter((file) => !/\.d\.[cm]?ts$/.test(file))
      .map((file) => path.relative(root, file).split(path.sep).join('/'))
    const rootDir = parsed.options.rootDir
    const from = rootDir === undefined ? commonDir(inputs) : path.relative(root, rootDir).split(path.sep).join('/') || '.'

    return (file) => {
      if (!file.startsWith(`${out}/`)) return []
      const rest = file.slice(out.length + 1)
      const ext = path.posix.extname(rest)
      const stem = path.posix.join(from, rest.slice(0, rest.length - ext.length))
      return (EMITTED[ext] ?? [ext]).map((to) => `${stem}${to}`)
    }
  } catch {
    return () => []
  }
}
