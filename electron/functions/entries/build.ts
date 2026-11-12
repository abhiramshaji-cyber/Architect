import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { EntryReason } from '../../../shared/types'
import { configsOf, field, pathOf, pathsOf, valueOf } from './config'

export type Built = { file: string; name: string | null; reason: EntryReason | null; outDir: string }

const CONFIG = /^((electron\.)?vite(\.[\w-]+)?|tsup|tsdown)\.config\.[cm]?[jt]s$/

const SIDES = [
  { key: 'main', reason: 'electronMain', home: 'src/main' },
  { key: 'preload', reason: 'preload', home: 'src/preload' },
  { key: 'renderer', reason: 'renderer', home: 'src/renderer' },
] as const

function read(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

function scriptsOf(root: string, html: string, base: string): string[] {
  const text = (read(path.join(root, html)) ?? '').replace(/<!--[\s\S]*?-->/g, '')
  return [...text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)].flatMap((match) => {
    const src = match[1] ?? ''
    if (/^[a-z]+:|^\/\//i.test(src)) return []
    return [path.posix.normalize(src.startsWith('/') ? path.posix.join(base, src) : path.posix.join(path.posix.dirname(html), src))]
  })
}

function sideOf(
  root: string,
  source: ts.SourceFile,
  options: ts.Expression | undefined,
  defaults: { reason: EntryReason | null; outDir: string; base: string; html: boolean },
): Built[] {
  const base = pathOf(source, field(source, options, 'root')) ?? defaults.base
  const written = field(source, options, 'build', 'outDir')
  const out = pathOf(source, written) ?? defaults.outDir
  const relative = defaults.reason === null && (written === undefined || ts.isStringLiteralLike(written))
  const outDir = path.posix.normalize(relative ? path.posix.join(base, out) : out)
  const lib = field(source, options, 'build', 'lib')
  const fileName = valueOf(source, field(source, lib, 'fileName'))
  const named = fileName && ts.isStringLiteralLike(fileName) ? fileName.text : null
  const declared = [
    ...pathsOf(source, field(source, lib, 'entry')),
    ...pathsOf(source, field(source, options, 'build', 'rollupOptions', 'input')),
  ]
  const fallback = defaults.html ? [{ name: null, file: path.posix.join(base, 'index.html') }] : []
  const reason = (html: boolean) => defaults.reason ?? (html ? 'page' : null)

  return (declared.length > 0 ? declared : fallback).flatMap(({ name, file }) =>
    file.endsWith('.html')
      ? scriptsOf(root, file, base).map((script) => ({ file: script, name: null, reason: reason(true), outDir }))
      : [{ file, name: named ?? name, reason: reason(false), outDir }],
  )
}

function electronSides(root: string, source: ts.SourceFile, config: ts.ObjectLiteralExpression): Built[] {
  return SIDES.flatMap(({ key, reason, home }) => {
    const options = field(source, config, key)
    const built = sideOf(root, source, options, { reason, outDir: `out/${key}`, base: home, html: key === 'renderer' })
    if (built.length > 0 || key === 'renderer') return built
    const index = ['ts', 'js', 'mts', 'mjs', 'cjs', 'cts'].map((ext) => `${home}/index.${ext}`)
    return index.map((file) => ({ file, name: null, reason, outDir: `out/${key}` }))
  })
}

function bundled(source: ts.SourceFile, config: ts.ObjectLiteralExpression): Built[] {
  const outDir = path.posix.normalize(pathOf(source, field(source, config, 'outDir')) ?? 'dist')
  return pathsOf(source, field(source, config, 'entry')).map(({ name, file }) => ({ file, name, reason: null, outDir }))
}

export function builtIn(root: string): Built[] {
  let names: string[]
  try {
    names = fs.readdirSync(root).filter((name) => CONFIG.test(name)).sort()
  } catch {
    return []
  }

  return names.flatMap((name) => {
    const text = read(path.join(root, name))
    if (text === undefined) return []
    const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true)
    return configsOf(source).flatMap((config) => {
      if (name.startsWith('electron.')) return electronSides(root, source, config)
      if (!name.startsWith('vite')) return bundled(source, config)
      const lib = field(source, config, 'build', 'lib')?.kind === ts.SyntaxKind.ObjectLiteralExpression
      return sideOf(root, source, config, { reason: null, outDir: 'dist', base: '.', html: !lib })
    })
  })
}
