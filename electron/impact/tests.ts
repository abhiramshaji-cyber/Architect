import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { FileEntry } from '../../shared/types'
import { isTestFile } from '../scan/starts'
import type { Fn } from '../where/refs'
import { refIndex, type Reach } from './callers'
import type { TestReach } from './schema'

const LISTED = 10

const at = (fn: Fn) => `${fn.file}:${fn.line}`

const bare = (file: string) => file.replace(/\.[cm]?[jt]sx?$/, '').replace(/\/index$/, '')

type Loaded = { target: string; line: number; names: string[] | null }

function namesOf(node: ts.Node): string[] | null | undefined {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause
    if (clause?.isTypeOnly) return []
    if (!clause) return []
    if (clause.name || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))) return null
    return (clause.namedBindings?.elements ?? []).filter((element) => !element.isTypeOnly).map((element) => (element.propertyName ?? element.name).text)
  }
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return []
    return node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.filter((element) => !element.isTypeOnly).map((element) => (element.propertyName ?? element.name).text) : null
  }
  return null
}

function specOf(node: ts.Node): ts.Expression | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) return undefined
  const loads = node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')
  return loads ? node.arguments[0] : undefined
}

export function importsOf(root: string, test: string): Loaded[] | 'unreadable' {
  let text: string
  try {
    text = fs.readFileSync(path.join(root, test), 'utf8')
  } catch {
    return 'unreadable'
  }
  const source = ts.createSourceFile(test, text, ts.ScriptTarget.Latest, true)
  const found: Loaded[] = []
  const visit = (node: ts.Node): void => {
    const spec = specOf(node)
    const names = spec === undefined ? undefined : namesOf(node)
    if (spec !== undefined && names !== undefined && ts.isStringLiteralLike(spec) && spec.text.startsWith('.')) {
      found.push({ target: bare(path.posix.join(path.posix.dirname(test), spec.text)), line: source.getLineAndCharacterOfPosition(spec.getStart(source)).line + 1, names })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function reachedOf(fns: Fn[], reach: Reach, node: number): number {
  let current = node
  while (fns[current]?.test === true && reach.parent.has(current)) current = reach.parent.get(current) as number
  return current
}

function exposedBy(fns: Fn[], files: FileEntry[]): Map<string, number[]> {
  const index = refIndex(fns)
  return new Map(files.map((file) => {
    const own = file.functions.map((_, fn) => index({ file: file.path, fn }))
    const forwarded = (file.starts ?? []).filter((start) => start.kind === 'exports').flatMap((start) => start.calls.map(index))
    return [file.path, [...own, ...forwarded].filter((i): i is number => i !== undefined).sort((a, b) => a - b)]
  }))
}

type Hit = { via: 'touched' | 'call' | 'import'; at: string; reaches: string; unchecked?: string }

export function testsOf(root: string, fns: Fn[], files: FileEntry[], reach: Reach, added: { file: string; line: number; name: string }[]): { total: number; listed: TestReach[]; notes: string[] } {
  const found = new Map<string, Hit>()

  for (const node of [...reach.depth.keys()].sort((a, b) => a - b)) {
    const fn = fns[node]
    if (fn === undefined || !fn.test || found.has(fn.file)) continue
    if (reach.depth.get(node) === 0) {
      found.set(fn.file, { via: 'touched', at: at(fn), reaches: at(fn) })
      continue
    }
    const reached = fns[reachedOf(fns, reach, node)]
    if (reached && !reached.test) found.set(fn.file, { via: 'call', at: at(fn), reaches: at(reached) })
  }

  for (const spot of added) if (isTestFile(spot.file) && !found.has(spot.file)) found.set(spot.file, { via: 'touched', at: `${spot.file}:${spot.line}`, reaches: `${spot.file}:${spot.line}` })

  const exposed = exposedBy(fns, files)
  const named = (fn: { name: string }, names: string[] | null) => names === null || names.includes(fn.name.split('.')[0] ?? '')
  const reachable = (target: string) => added.some((spot) => spot.file === target) || (exposed.get(target) ?? []).some((i) => reach.depth.has(i) && fns[i]?.test === false)
  for (const file of files) {
    if (!isTestFile(file.path) || found.has(file.path) || !(file.imports ?? []).some(reachable)) continue
    const loaded = importsOf(root, file.path)
    for (const target of file.imports ?? []) {
      const entries = loaded === 'unreadable' ? [] : loaded.filter((entry) => entry.target === bare(target))
      const ways = entries.length > 0 ? entries : [{ target, line: 0, names: null }]
      const hit = ways.flatMap((way) => {
        const index = (exposed.get(target) ?? []).find((i) => reach.depth.has(i) && fns[i]?.test === false && named(fns[i] as Fn, way.names))
        const reached = index === undefined ? undefined : fns[index]
        const spot = added.find((one) => one.file === target && named(one, way.names))
        const fresh = spot ? `${spot.file}:${spot.line}` : undefined
        return reached || fresh ? [{ way, reaches: reached ? at(reached) : (fresh as string) }] : []
      })[0]
      if (hit === undefined) continue
      const unchecked = loaded === 'unreadable' ? `${file.path} could not be read, so the names it imports are not checked` : entries.length === 0 ? `${file.path} imports ${target} by a path that is not relative, so its import line and names are not checked` : undefined
      found.set(file.path, { via: 'import', at: hit.way.line > 0 ? `${file.path}:${hit.way.line}` : file.path, reaches: hit.reaches, ...(unchecked ? { unchecked } : {}) })
      break
    }
  }

  const shown = [...found].sort(([a], [b]) => a.localeCompare(b)).slice(0, LISTED)
  const listed = shown.map(([file, { via, at: line, reaches }]): TestReach => ({ file, via, at: line, reaches }))
  const lineless = shown.flatMap(([, hit]) => (hit.unchecked ? [hit.unchecked] : []))
  const cut = found.size > LISTED ? [`${found.size - LISTED} of ${found.size} test files are counted but not listed`] : []
  const loose = listed.some((test) => test.via === 'import') ? ['a test listed via import imports a reached function by name, or a whole file holding one; the scan does not see calls inside test callbacks, so it may not call it'] : []
  return { total: found.size, listed, notes: [...cut, ...lineless, ...loose] }
}
