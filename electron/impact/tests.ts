import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { FileEntry } from '../../shared/types'
import { isTestFile } from '../scan/starts'
import type { Fn } from '../where/refs'
import type { Reach } from './callers'
import type { TestReach } from './schema'

const LISTED = 10

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

function exposedBy(fns: Fn[], files: FileEntry[]): Map<string, number[]> {
  const offset = new Map<string, number>()
  fns.forEach((fn, i) => offset.has(fn.file) || offset.set(fn.file, i))
  const indexOf = (file: string, fn: number) => (offset.get(file) ?? Number.NaN) + fn
  return new Map(files.map((file) => {
    const own = file.functions.map((_, fn) => indexOf(file.path, fn))
    const forwarded = (file.starts ?? []).filter((start) => start.kind === 'exports').flatMap((start) => start.calls.map((call) => indexOf(call.file, call.fn)))
    return [file.path, [...own, ...forwarded].filter((i) => Number.isInteger(i)).sort((a, b) => a - b)]
  }))
}

type Hit = { via: 'call'; at: string; reaches: string } | { via: 'import'; target: string; reaches: string }

export function testsOf(root: string, fns: Fn[], files: FileEntry[], reach: Reach, added: { file: string; line: number } | undefined): { total: number; listed: TestReach[]; notes: string[] } {
  const found = new Map<string, Hit>()

  for (const node of [...reach.depth.keys()].sort((a, b) => a - b)) {
    const fn = fns[node]
    if (fn === undefined || !fn.test || reach.depth.get(node) === 0 || found.has(fn.file)) continue
    const reached = fns[reachedOf(fns, reach, node)]
    if (reached && !reached.test) found.set(fn.file, { via: 'call', at: at(fn), reaches: at(reached) })
  }

  const exposed = exposedBy(fns, files)
  const reachedIn = (file: string) => (exposed.get(file) ?? []).find((i) => reach.depth.has(i) && fns[i]?.test === false)
  for (const file of files) {
    if (!isTestFile(file.path) || found.has(file.path)) continue
    for (const target of file.imports ?? []) {
      const hit = reachedIn(target)
      const reached = hit === undefined ? undefined : fns[hit]
      if (reached === undefined && target !== added?.file) continue
      found.set(file.path, { via: 'import', target, reaches: reached ? at(reached) : `${target}:${added?.line}` })
      break
    }
  }

  const lineless: string[] = []
  const listed = [...found].sort(([a], [b]) => a.localeCompare(b)).slice(0, LISTED).map(([file, hit]): TestReach => {
    if (hit.via === 'call') return { file, ...hit }
    const line = importLine(root, file, hit.target)
    if (line === null) lineless.push(`${file} imports ${hit.target} by a path that is not relative, so its import line is not given`)
    return { file, via: 'import', at: line === null ? file : `${file}:${line}`, reaches: hit.reaches }
  })
  const cut = found.size > LISTED ? [`${found.size - LISTED} of ${found.size} test files are counted but not listed`] : []
  return { total: found.size, listed, notes: [...cut, ...lineless] }
}
