import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { FileEntry } from '../../shared/types'
import { isTestFile } from '../scan/starts'
import type { Fn } from '../where/refs'
import type { Reach } from './callers'
import type { TestReach } from './schema'

const LISTED = 20

const at = (fn: Fn) => `${fn.file}:${fn.line}`

const bare = (file: string) => file.replace(/\.[cm]?[jt]sx?$/, '').replace(/\/index$/, '')

function specOf(node: ts.Node): ts.Expression | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) return undefined
  const loads = node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')
  return loads ? node.arguments[0] : undefined
}

export function importLine(root: string, test: string, target: string): number | null {
  let text: string
  try {
    text = fs.readFileSync(path.join(root, test), 'utf8')
  } catch {
    return null
  }
  const source = ts.createSourceFile(test, text, ts.ScriptTarget.Latest, true)
  const wanted = bare(target)
  let line: number | null = null
  const visit = (node: ts.Node): void => {
    if (line !== null) return
    const spec = specOf(node)
    if (spec !== undefined && ts.isStringLiteralLike(spec) && spec.text.startsWith('.') && bare(path.posix.join(path.posix.dirname(test), spec.text)) === wanted) {
      line = source.getLineAndCharacterOfPosition(spec.getStart(source)).line + 1
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return line
}

function reachedOf(fns: Fn[], reach: Reach, node: number): number {
  let current = node
  while (fns[current]?.test === true && reach.parent.has(current)) current = reach.parent.get(current) as number
  return current
}

export function testsOf(root: string, fns: Fn[], files: FileEntry[], reach: Reach, added: { file: string; line: number } | undefined): { total: number; listed: TestReach[] } {
  const found = new Map<string, { via: 'call'; at: string; reaches: string } | { via: 'import'; target: string; reaches: string }>()

  for (const node of [...reach.depth.keys()].sort((a, b) => a - b)) {
    const fn = fns[node]
    if (fn === undefined || !fn.test || reach.depth.get(node) === 0 || found.has(fn.file)) continue
    const reached = fns[reachedOf(fns, reach, node)]
    if (reached && !reached.test) found.set(fn.file, { via: 'call', at: at(fn), reaches: at(reached) })
  }

  const first = new Map<string, Fn>()
  for (const node of [...reach.depth.keys()].sort((a, b) => a - b)) {
    const fn = fns[node]
    if (fn && !fn.test && !first.has(fn.file)) first.set(fn.file, fn)
  }

  for (const file of files) {
    if (!isTestFile(file.path) || found.has(file.path)) continue
    const target = (file.imports ?? []).find((imported) => first.has(imported) || imported === added?.file)
    if (target === undefined) continue
    const reached = first.get(target)
    found.set(file.path, { via: 'import', target, reaches: reached ? at(reached) : `${target}:${added?.line}` })
  }

  const listed = [...found].sort(([a], [b]) => a.localeCompare(b)).slice(0, LISTED).map(([file, hit]): TestReach => {
    if (hit.via === 'call') return { file, ...hit }
    const line = importLine(root, file, hit.target)
    return { file, via: 'import', at: line === null ? file : `${file}:${line}`, reaches: hit.reaches }
  })
  return { total: found.size, listed }
}
