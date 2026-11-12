import path from 'node:path'
import ts from 'typescript'

const EMITTED: Record<string, string[]> = {
  '.js': ['.ts', '.tsx', '.js', '.jsx'],
  '.mjs': ['.mts', '.mjs', '.ts', '.tsx', '.js', '.jsx'],
  '.cjs': ['.cts', '.cjs', '.ts', '.tsx', '.js', '.jsx'],
}

function inPlace(file: string): string[] {
  const ext = path.posix.extname(file)
  const stem = file.slice(0, file.length - ext.length)
  return (EMITTED[ext] ?? []).map((to) => `${stem}${to}`)
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
    if (read.error !== undefined) return inPlace
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root)
    const outDir = parsed.options.outDir
    if (outDir === undefined) return inPlace
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
    return inPlace
  }
}
