import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { FileEntry } from '../../shared/types'
import { isTestFile } from '../scan/starts'
import type { Fn } from '../where/refs'
import { refIndex, type Reach } from './callers'
import type { TestReach } from './schema'
import { sourceOf } from './touched'

const LISTED = 10

const at = (fn: Fn) => `${fn.file}:${fn.line}`

export const bare = (file: string) => file.replace(/\.[cm]?[jt]sx?$/i, '').replace(/\/index$/, '')

type Loaded = { target: string; line: number; names: string[] | null; forwards: boolean }

const picked = (elements: readonly (ts.ImportSpecifier | ts.ExportSpecifier)[], types: boolean) => elements.filter((element) => types || !element.isTypeOnly).map((element) => (element.propertyName ?? element.name).text)

function namesOf(node: ts.Node, types: boolean): string[] | null {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause
    if (!clause || (clause.isTypeOnly && !types)) return []
    if (clause.name || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))) return null
    return picked(clause.namedBindings?.elements ?? [], types || clause.isTypeOnly)
  }
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly && !types) return []
    return node.exportClause && ts.isNamedExports(node.exportClause) ? picked(node.exportClause.elements, types || node.isTypeOnly) : null
  }
  return null
}

function specOf(node: ts.Node): ts.Expression | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) return undefined
  const loads = node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')
  return loads ? node.arguments[0] : undefined
}

export function importsOf(root: string, test: string, types = false): Loaded[] | 'unreadable' {
  let text: string
  try {
    text = fs.readFileSync(path.join(root, test), 'utf8')
  } catch {
    return 'unreadable'
  }
  const source = sourceOf(test, text)
  const found: Loaded[] = []
  const visit = (node: ts.Node): void => {
    const spec = specOf(node)
    const names = spec === undefined ? undefined : namesOf(node, types)
    if (spec !== undefined && names !== undefined && ts.isStringLiteralLike(spec) && spec.text.startsWith('.')) {
      found.push({ target: bare(path.posix.join(path.posix.dirname(test), spec.text)), line: source.getLineAndCharacterOfPosition(spec.getStart(source)).line + 1, names, forwards: ts.isExportDeclaration(node) })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

export function aliasesOf(root: string, file: string): Map<string, string> {
  const aliases = new Map<string, string>()
  let text: string
  try {
    text = fs.readFileSync(path.join(root, file), 'utf8')
  } catch {
    return aliases
  }
  for (const statement of sourceOf(file, text).statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue
    for (const element of statement.exportClause.elements) if (element.propertyName) aliases.set(element.name.text, element.propertyName.text)
  }
  return aliases
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

export function testsOf(root: string, fns: Fn[], files: FileEntry[], reach: Reach, added: { file: string; line: number; name: string }[], edited?: { file: string; line: number }, whole?: string): { total: number; listed: TestReach[]; notes: string[] } {
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

  if (edited && isTestFile(edited.file)) found.set(edited.file, { via: 'touched', at: `${edited.file}:${edited.line}`, reaches: `${edited.file}:${edited.line}` })
  for (const spot of added) if (isTestFile(spot.file) && !found.has(spot.file)) found.set(spot.file, { via: 'touched', at: `${spot.file}:${spot.line}`, reaches: `${spot.file}:${spot.line}` })

  const exposed = exposedBy(fns, files)
  const named = (fn: { name: string }, names: string[] | null) => names === null || names.includes(fn.name.split('.')[0] ?? '')
  const memo = new Map<string, Map<string, string>>()
  const renamed = (file: string) => memo.get(file) ?? (memo.set(file, aliasesOf(root, file)).get(file) as Map<string, string>)
  const originals = (target: string, names: string[] | null) => {
    if (names === null) return null
    const forwarded = [...new Set((exposed.get(target) ?? []).map((i) => fns[i]?.file ?? target))].filter((file) => file !== target)
    return names.flatMap((name) => {
      const one = renamed(target).get(name) ?? name
      return [one, ...forwarded.flatMap((file) => renamed(file).get(one) ?? [])]
    })
  }
  const reachable = (target: string) => target === whole || added.some((spot) => spot.file === target) || (exposed.get(target) ?? []).some((i) => reach.depth.has(i) && fns[i]?.test === false)
  for (const file of files) {
    if (!isTestFile(file.path) || found.has(file.path) || !(file.imports ?? []).some(reachable)) continue
    const loaded = importsOf(root, file.path)
    for (const target of file.imports ?? []) {
      const entries = loaded === 'unreadable' ? [] : loaded.filter((entry) => entry.target === bare(target))
      const ways = (entries.length > 0 ? entries : [{ target, line: 0, names: null, forwards: false }]).map((way) => ({ ...way, names: originals(target, way.names) }))
      const hit = ways.flatMap((way) => {
        const index = (exposed.get(target) ?? []).find((i) => reach.depth.has(i) && fns[i]?.test === false && named(fns[i] as Fn, way.names))
        const reached = index === undefined ? undefined : fns[index]
        const spot = added.find((one) => one.file === target && named(one, way.names))
        const fresh = spot ? `${spot.file}:${spot.line}` : undefined
        const outside = target === whole && (way.names === null || way.names.length > 0) ? whole : undefined
        return reached || fresh || outside ? [{ way, reaches: reached ? at(reached) : (fresh ?? (outside as string)) }] : []
      })[0]
      if (hit === undefined) continue
      const unchecked = loaded === 'unreadable' ? `${file.path} could not be read, so the names it imports are not checked` : entries.length === 0 ? `${file.path} imports ${target} by a path that is not relative, so its import line and names are not checked` : undefined
      found.set(file.path, { via: 'import', at: hit.way.line > 0 ? `${file.path}:${hit.way.line}` : file.path, reaches: hit.reaches, ...(unchecked ? { unchecked } : {}) })
      break
    }
  }

  const rank = (hit: Hit) => ['touched', 'call', 'import'].indexOf(hit.via)
  const shown = [...found].sort(([a, x], [b, y]) => rank(x) - rank(y) || a.localeCompare(b)).slice(0, LISTED)
  const listed = shown.map(([file, { via, at: line, reaches }]): TestReach => ({ file, via, at: line, reaches }))
  const lineless = shown.flatMap(([, hit]) => (hit.unchecked ? [hit.unchecked] : []))
  const cut = found.size > LISTED ? [`${found.size - LISTED} of ${found.size} test files are counted but not listed`] : []
  const loose = listed.some((test) => test.via === 'import') ? ['a test listed via import imports a reached function by name, or a whole file holding one; the scan does not see calls inside test callbacks, so it may not call it'] : []
  return { total: found.size, listed, notes: [...cut, ...lineless, ...loose] }
}

type Loads = ReturnType<typeof importsOf>

export function importersOf(root: string, file: string, names: string[] | 'all', files: FileEntry[]): Set<string> {
  const [found, seen, loads] = [new Set<string>(), new Set<string>([file]), new Map<string, Loads>()]
  const queue = [{ target: file, wanted: names }]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const { target, wanted } = next
    for (const entry of files) {
      if (isTestFile(entry.path) || !(entry.imports ?? []).includes(target)) continue
      const loaded = loads.get(entry.path) ?? (loads.set(entry.path, importsOf(root, entry.path, true)).get(entry.path) as Loads)
      const ways = loaded === 'unreadable' ? [] : loaded.filter((way) => way.target === bare(target))
      const hits = ways.length === 0 ? [{ forwards: false }] : ways.filter((way) => wanted === 'all' || way.names === null || way.names.some((name) => wanted.includes(name)))
      if (hits.length === 0) continue
      found.add(entry.path)
      if (!hits.some((hit) => hit.forwards) || seen.has(entry.path)) continue
      seen.add(entry.path)
      const aliases = [...aliasesOf(root, entry.path)].filter(([, original]) => wanted === 'all' || wanted.includes(original)).map(([alias]) => alias)
      queue.push({ target: entry.path, wanted: wanted === 'all' ? 'all' : [...wanted, ...aliases] })
    }
  }
  return found
}
