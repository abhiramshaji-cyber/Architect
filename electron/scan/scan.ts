import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { CallRef, CodeMap, FileEntry, FileStart, FolderEntry, FunctionEntry } from '../../shared/types'
import { link, type Parsed, type Pending, type Raw } from './link'
import { calleeName, isTestFile, lineOf, startsIn, type Call, type Site } from './starts'
import { docOf, renderedTag, signatureOf } from './traits'
import { usedIn } from './values'
import { isCode, lineCount } from '../rules/facts'

export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  'coverage',
  'public',
  'vendor',
  '.next',
  '.architect',
  '.claude',
])

const YIELD_EVERY = 50

const SCRIPT_KINDS = new Map<string, ts.ScriptKind>([
  ['.ts', ts.ScriptKind.TS],
  ['.mts', ts.ScriptKind.TS],
  ['.cts', ts.ScriptKind.TS],
  ['.tsx', ts.ScriptKind.TSX],
  ['.js', ts.ScriptKind.JSX],
  ['.jsx', ts.ScriptKind.JSX],
  ['.mjs', ts.ScriptKind.JSX],
  ['.cjs', ts.ScriptKind.JSX],
])

function propertyName(name: ts.PropertyName | ts.BindingName): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  if (ts.isComputedPropertyName(name)) {
    const inner = name.expression
    if (ts.isStringLiteral(inner) || ts.isNumericLiteral(inner)) return inner.text
    return undefined
  }
  return undefined
}

function isFunctionValue(node: ts.Node | undefined): boolean {
  return node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
}

function declaredName(node: ts.Node, owner: string): string | undefined {
  const prefix = owner ? `${owner}.` : ''

  if (ts.isFunctionDeclaration(node)) return (ts.isModuleBlock(node.parent) ? prefix : '') + (node.name?.text ?? 'default')
  if (ts.isConstructorDeclaration(node)) return `${owner || 'default'}.constructor`

  if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    const name = propertyName(node.name)
    return name === undefined ? undefined : prefix + name
  }

  if (ts.isPropertyDeclaration(node) && isFunctionValue(node.initializer)) {
    const name = propertyName(node.name)
    return name === undefined ? undefined : prefix + name
  }

  if (ts.isPropertyAssignment(node) && isFunctionValue(node.initializer)) {
    const name = propertyName(node.name)
    return name === undefined ? undefined : prefix + name
  }

  if (ts.isVariableDeclaration(node) && isFunctionValue(node.initializer)) {
    const name = propertyName(node.name)
    return name === undefined ? undefined : name
  }

  if (ts.isExportAssignment(node) && isFunctionValue(node.expression)) return 'default'

  return undefined
}

function isTransparent(node: ts.Node): boolean {
  return (
    ts.isObjectLiteralExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  )
}

function ownerFor(node: ts.Node, owner: string): string {
  if (ts.isClassDeclaration(node) && node.name === undefined) return 'default'
  if (ts.isClassLike(node)) return node.name?.text ?? owner
  if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) && !(node.flags & ts.NodeFlags.GlobalAugmentation)) {
    return owner ? `${owner}.${node.name.text}` : node.name.text
  }
  if (ts.isModuleBlock(node)) return owner
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text
  if (ts.isExportAssignment(node)) return 'default'
  if (isTransparent(node)) return owner

  if (ts.isPropertyAssignment(node)) {
    const name = propertyName(node.name)
    if (name === undefined) return ''
    return owner ? `${owner}.${name}` : name
  }

  return ''
}

type Found = { entry: FunctionEntry; node: ts.Node; owner: string; self: string }

function valueOf(node: ts.Node): ts.Node | undefined {
  if (ts.isExportAssignment(node)) return node.expression
  if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node)) return node.initializer
  return node
}

function scopeOf(node: ts.Node): ts.Node | undefined {
  let at: ts.Node | undefined = node.parent
  while (at !== undefined && !ts.isFunctionLike(at) && !ts.isSourceFile(at)) at = at.parent
  return at
}

function isOverloadSignature(node: ts.Node): boolean {
  return (
    (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) &&
    node.body === undefined
  )
}

type ImportBinding = { spec: string; name: string | null }

function moduleSpecifier(node: ts.Expression | undefined): string | undefined {
  return node !== undefined && ts.isStringLiteral(node) ? node.text : undefined
}

function importBindings(source: ts.SourceFile): Map<string, ImportBinding | null> {
  const bindings = new Map<string, ImportBinding | null>()

  for (const statement of source.statements) {
    if (ts.isImportEqualsDeclaration(statement)) {
      const spec = ts.isExternalModuleReference(statement.moduleReference)
        ? moduleSpecifier(statement.moduleReference.expression)
        : undefined
      bindings.set(statement.name.text, spec === undefined ? null : { spec, name: null })
    }

    if (!ts.isImportDeclaration(statement) || statement.importClause === undefined) continue

    const clause = statement.importClause
    const spec = clause.isTypeOnly ? undefined : moduleSpecifier(statement.moduleSpecifier)

    if (clause.name) bindings.set(clause.name.text, spec === undefined ? null : { spec, name: 'default' })

    const named = clause.namedBindings
    if (named && ts.isNamespaceImport(named)) {
      bindings.set(named.name.text, spec === undefined ? null : { spec, name: null })
    }
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        const name = (element.propertyName ?? element.name).text
        const to = spec === undefined || element.isTypeOnly ? null : { spec, name }
        bindings.set(element.name.text, to)
      }
    }
  }

  return bindings
}

function boundNames(name: ts.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) return void into.add(name.text)
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) boundNames(element.name, into)
  }
}

function hasKeyword(statement: ts.Statement, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(statement)) return false
  return (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === kind)
}

function exportedFrom(
  statement: ts.Statement,
  imported: Map<string, ImportBinding | null>,
  into: Map<string, string>,
  forward: Map<string, { spec: string; name: string }>,
): void {
  const relay = (name: string, local: string): void => {
    const binding = imported.get(local)
    if (binding === null) return
    if (binding === undefined) return void into.set(name, local)
    forward.set(name, { spec: binding.spec, name: binding.name ?? '*' })
  }

  if (ts.isExportAssignment(statement)) {
    const expression = statement.expression
    return void (ts.isIdentifier(expression) ? relay('default', expression.text) : into.set('default', 'default'))
  }

  if (
    ts.isExportDeclaration(statement) &&
    statement.moduleSpecifier === undefined &&
    statement.exportClause &&
    ts.isNamedExports(statement.exportClause)
  ) {
    for (const element of statement.exportClause.elements) {
      relay(element.name.text, (element.propertyName ?? element.name).text)
    }
    return
  }

  if (!hasKeyword(statement, ts.SyntaxKind.ExportKeyword)) return
  const fallback = hasKeyword(statement, ts.SyntaxKind.DefaultKeyword)

  if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) return void into.set(statement.name.text, statement.name.text)

  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    const name = statement.name?.text ?? 'default'
    into.set(name, name)
    if (fallback) into.set('default', name)
    return
  }

  if (ts.isVariableStatement(statement)) {
    const names = new Set<string>()
    for (const declaration of statement.declarationList.declarations) boundNames(declaration.name, names)
    for (const name of names) into.set(name, name)
  }
}

function reexportedFrom(
  statement: ts.Statement,
  into: Map<string, { spec: string; name: string }>,
  stars: string[],
): void {
  if (!ts.isExportDeclaration(statement)) return
  const spec = moduleSpecifier(statement.moduleSpecifier)
  if (spec === undefined) return

  const clause = statement.exportClause
  if (clause === undefined) return void stars.push(spec)
  if (ts.isNamespaceExport(clause)) return void into.set(clause.name.text, { spec, name: '*' })

  for (const element of clause.elements) {
    into.set(element.name.text, { spec, name: (element.propertyName ?? element.name).text })
  }
}

function shadowsOf(source: ts.SourceFile): Map<ts.Node, Set<string>> {
  const byScope = new Map<ts.Node, Set<string>>()

  const at = (node: ts.Node): Set<string> | undefined => {
    const scope = ts.isParameter(node) ? node.parent : scopeOf(node)
    if (scope === undefined) return undefined
    const names = byScope.get(scope) ?? new Set<string>()
    byScope.set(scope, names)
    return names
  }

  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) || ts.isVariableDeclaration(node)) boundNames(node.name, at(node) ?? new Set())
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      boundNames(node.variableDeclaration.name, at(node.variableDeclaration) ?? new Set())
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return byScope
}

function isMember(node: ts.Node): boolean {
  return ts.isClassElement(node) || ts.isObjectLiteralElement(node)
}

function bindingsOf(found: Found[]): Map<ts.Node, Map<string, number>> {
  const byScope = new Map<ts.Node, Map<string, number>>()

  for (const [i, f] of found.entries()) {
    const scope = scopeOf(f.node)
    if (scope === undefined || (f.owner === '' && isMember(f.node))) continue

    const names = byScope.get(scope) ?? new Map<string, number>()
    byScope.set(scope, names)

    const prev = names.get(f.entry.name)
    const previous = prev === undefined ? undefined : found[prev]
    if (previous === undefined || !isOverloadSignature(f.node) || isOverloadSignature(previous.node)) {
      names.set(f.entry.name, i)
    }
    const bare = f.entry.name.split('.').pop() ?? f.entry.name
    if (ts.isModuleBlock(f.node.parent) && !names.has(bare)) names.set(bare, i)
  }

  return byScope
}

function resolveCall(
  name: string,
  at: ts.Node,
  byScope: Map<ts.Node, Map<string, number>>,
  shadows: Map<ts.Node, Set<string>>,
  imported: Map<string, ImportBinding | null>,
): Call | undefined {
  const root = name.split('.')[0] ?? name

  for (let scope = scopeOf(at); scope !== undefined; scope = scopeOf(scope)) {
    const hit = byScope.get(scope)?.get(name)
    if (hit !== undefined) return hit
    if (shadows.get(scope)?.has(root)) return undefined
    if (ts.isSourceFile(scope) && imported.has(root)) return { name, root }
  }

  return undefined
}

function membersOf(
  name: string,
  at: ts.Node,
  byScope: Map<ts.Node, Map<string, number>>,
  shadows: Map<ts.Node, Set<string>>,
  imported: Map<string, ImportBinding | null>,
): Call[] {
  const root = name.split('.')[0] ?? name
  for (let scope = scopeOf(at); scope !== undefined; scope = scopeOf(scope)) {
    const hits = [...(byScope.get(scope) ?? [])].filter(([key]) => key.startsWith(`${name}.`)).map(([, fn]) => fn)
    if (hits.length > 0) return hits
    if (shadows.get(scope)?.has(root)) return []
    if (ts.isSourceFile(scope) && imported.has(root)) return [{ name, root }]
  }
  return []
}

function isFree(
  root: string,
  at: ts.Node,
  byScope: Map<ts.Node, Map<string, number>>,
  shadows: Map<ts.Node, Set<string>>,
  imported: Map<string, ImportBinding | null>,
): boolean {
  for (let scope = scopeOf(at); scope !== undefined; scope = scopeOf(scope)) {
    if (byScope.get(scope)?.has(root) || shadows.get(scope)?.has(root)) return false
    if (ts.isSourceFile(scope) && imported.has(root)) return false
  }
  return true
}

type Resolver = { resolve: (name: string, at: ts.Node) => Call | undefined; free: (root: string, at: ts.Node) => boolean }

function callsIn(node: ts.Node, self: string, nested: Set<ts.Node>, { resolve, free }: Resolver): Site[] {
  const sites: Site[] = []

  const own = valueOf(node)
  const visit = (child: ts.Node, self: string): void => {
    if (child !== node && nested.has(child)) return

    const callee = ts.isCallExpression(child) ? child.expression : renderedTag(child)
    const name = callee === undefined ? undefined : calleeName(callee, self)
    const target = name === undefined ? undefined : resolve(name, child)
    if (target !== undefined) sites.push({ call: target, line: lineOf(child) })
    else if (name?.startsWith('window.') && name.split('.').length > 2 && free('window', child)) {
      sites.push({ bridge: name.slice('window.'.length), line: lineOf(child) })
    }

    const rebinds = child !== node && child !== own && ts.isFunctionLike(child) && !ts.isArrowFunction(child)
    ts.forEachChild(child, (next) => visit(next, rebinds ? '' : self))
  }

  visit(node, self)
  return sites
}

function distinct(sites: Site[]): Call[] {
  const found = new Map<string, Call>()
  for (const site of sites) {
    if ('call' in site) found.set(typeof site.call === 'number' ? `#${site.call}` : `@${site.call.name}`, site.call)
  }
  return [...found.values()]
}

function empty(): Parsed {
  return { functions: [], starts: [], topLevel: new Map(), exports: new Map(), reexports: new Map(), stars: [], pending: [], raw: new Map(), specs: new Set(), typed: new Set(), computed: false }
}

function isTypeOnly(node: ts.Node): boolean {
  if (ts.isExportDeclaration(node)) return node.isTypeOnly
  if (!ts.isImportDeclaration(node) || node.importClause === undefined) return false
  const clause = node.importClause
  const named = clause.namedBindings
  const elements = named && ts.isNamedImports(named) ? named.elements : undefined
  return clause.isTypeOnly || (clause.name === undefined && elements !== undefined && elements.length > 0 && elements.every((one) => one.isTypeOnly))
}

function loadedSpec(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return moduleSpecifier(node.moduleSpecifier)
  if (ts.isExternalModuleReference(node)) return moduleSpecifier(node.expression)
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) return undefined
  const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword
  const required = ts.isIdentifier(node.expression) && node.expression.text === 'require'
  return dynamic || required ? moduleSpecifier(node.arguments[0]) : undefined
}

function parseFile(source: string, file: string): Parsed {
  const lower = file.toLowerCase()
  if (lower.endsWith('.d.ts') || lower.endsWith('.d.mts') || lower.endsWith('.d.cts')) return empty()

  const kind = SCRIPT_KINDS.get(path.extname(lower))
  if (kind === undefined) return empty()

  try {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
    const found: Found[] = []
    const thisIn = new Map<ts.Node, string>()
    const specs = new Set<string>()
    const typed = new Set<string>()

    const visit = (node: ts.Node, owner: string, self: string): void => {
      const spec = loadedSpec(node)
      if (spec !== undefined) (isTypeOnly(node) ? typed : specs).add(spec)

      const name = declaredName(node, owner)
      if (name !== undefined) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
        const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1
        const value = valueOf(node)
        const bound = value !== undefined && ts.isArrowFunction(value) ? self : owner
        if (value !== undefined) thisIn.set(value, bound)
        found.push({ entry: { name, line, endLine, description: '', calls: [] }, node, owner, self: bound })
      }

      const next = ownerFor(node, owner)
      const inner = ts.isClassLike(node) ? next : ts.isFunctionLike(node) && !ts.isArrowFunction(node) ? (thisIn.get(node) ?? '') : self
      ts.forEachChild(node, (child) => visit(child, next, inner))
    }

    ts.forEachChild(sourceFile, (child) => visit(child, '', ''))

    const nested = new Set(found.map((f) => f.node))
    for (const f of found) {
      const doc = docOf(f.node, sourceFile)
      const signature = signatureOf(f.node, sourceFile)
      if (doc !== undefined) f.entry.doc = doc
      if (signature !== undefined) f.entry.signature = signature
    }
    const byScope = bindingsOf(found)
    const shadows = shadowsOf(sourceFile)
    const imported = importBindings(sourceFile)
    const resolve = (name: string, at: ts.Node) => resolveCall(name, at, byScope, shadows, imported)
    const resolver: Resolver = { resolve, free: (root, at) => isFree(root, at, byScope, shadows, imported) }
    const sites = found.map((f) => callsIn(f.node, f.self, nested, resolver))
    const sitesIn = (node: ts.Node) => callsIn(node, '', nested, resolver)
    const opened = startsIn(sourceFile, found.map((f) => f.node), nested, resolve, imported, sitesIn)
    const index = new Map(found.map((f, i) => [f.node, i]))
    const lookup = {
      resolve,
      members: (name: string, at: ts.Node) => membersOf(name, at, byScope, shadows, imported),
      local: (node: ts.Node) => index.get(node),
    }
    const { used, linked, computed } = isTestFile(file)
      ? { used: [], linked: [], computed: false }
      : usedIn([...found.map((f) => ({ node: f.node, self: f.self })), { node: sourceFile, self: '' }], nested, lookup, imported)
    if (used.length + linked.length > 0) opened.push({ kind: 'value', calls: used })

    const order = found
      .map((f, i) => ({ f, i }))
      .sort((a, b) => a.f.entry.line - b.f.entry.line || a.f.entry.name.localeCompare(b.f.entry.name))
    const rank = new Map(order.map(({ i }, to) => [i, to]))

    const exports = new Map<string, string>()
    const reexports = new Map<string, { spec: string; name: string }>()
    const stars: string[] = []
    for (const statement of sourceFile.statements) {
      exportedFrom(statement, imported, exports, reexports)
      reexportedFrom(statement, reexports, stars)
    }

    const topLevel = new Map<string, number>()
    for (const [name, at] of byScope.get(sourceFile) ?? []) {
      const to = rank.get(at)
      if (to !== undefined) topLevel.set(name, to)
    }

    const importOf = (call: Exclude<Call, number>): { spec: string; key: string } | undefined => {
      const binding = imported.get(call.root)
      if (binding === null || binding === undefined) return undefined
      const rest = call.name.slice(call.root.length)
      const key = binding.name === null ? rest.slice(1) : binding.name + rest
      return key === '' ? undefined : { spec: binding.spec, key }
    }

    const pending: Pending[] = []
    const refsOf = (list: Call[], from: number): CallRef[] => {
      const refs: CallRef[] = []
      for (const call of list) {
        const to = typeof call === 'number' ? rank.get(call) : undefined
        const via = typeof call === 'number' ? undefined : importOf(call)
        if (to !== undefined) refs.push({ file, fn: to })
        if (via !== undefined) pending.push({ from, ...via })
      }
      return refs.sort((a, b) => a.fn - b.fn)
    }

    const raw = new Map<number, Raw[]>()
    const rawOf = (list: Site[], from: number): void => {
      const placed = list.flatMap((site): Raw[] => {
        if ('bridge' in site) return [site]
        const to = typeof site.call === 'number' ? rank.get(site.call) : undefined
        const via = typeof site.call === 'number' ? undefined : importOf(site.call)
        if (to !== undefined) return [{ line: site.line, ref: { file, fn: to } }]
        return via === undefined ? [] : [{ line: site.line, ...via }]
      })
      if (placed.length > 0) raw.set(from, placed)
    }

    const bound = new Set([...byScope.values()].flatMap((names) => [...names.values()]))
    const functions = order.map(({ f, i }, from) => {
      rawOf(sites[i] ?? [], from)
      const entry: FunctionEntry = { ...f.entry, calls: refsOf(distinct(sites[i] ?? []), from) }
      const accessor = ts.isGetAccessorDeclaration(f.node) || ts.isSetAccessorDeclaration(f.node)
      if (isOverloadSignature(f.node) || (accessor && !bound.has(i))) entry.twin = true
      return entry
    })
    const starts: FileStart[] = opened.map(({ sites: handled, ...start }, k) => {
      rawOf(handled ?? [], functions.length + k)
      return { ...start, calls: refsOf(start.calls, functions.length + k) }
    })

    for (const { spec, key } of linked) pending.push({ from: functions.length + starts.length - 1, spec, key })

    // reexports
    if (reexports.size > 0 || stars.length > 0) {
      for (const { spec, name } of reexports.values()) pending.push({ from: functions.length + starts.length, spec, key: name === '*' ? '' : name })
      starts.push({ kind: 'exports', calls: [] })
    }

    const exportedLocals = new Set(exports.values())
    for (const [name, at] of topLevel) {
      const fn = functions[at]
      if (fn !== undefined && exportedLocals.has(name.split('.')[0] ?? name)) fn.exported = true
    }
    for (const fn of functions) if (fn.twin && topLevel.has(fn.name) && exportedLocals.has(fn.name.split('.')[0] ?? fn.name)) fn.exported = true

    return { functions, starts, topLevel, exports, reexports, stars, pending, raw, specs, typed, computed }
  } catch {
    return empty()
  }
}

export function functionsIn(source: string, file: string): FunctionEntry[] {
  return parseFile(source, file).functions
}

function readText(file: string): string | undefined {
  try {
    const buffer = fs.readFileSync(file)
    if (buffer.subarray(0, 8192).includes(0)) return undefined
    return buffer.toString('utf8')
  } catch {
    return undefined
  }
}

function yieldToLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

type Walked = { into: FolderEntry[]; parsed: Map<string, Parsed>; counter: { seen: number }; digests: Map<string, string> }

async function walk(root: string, relative: string, { into, parsed, counter, digests }: Walked): Promise<void> {
  const absolute = relative ? path.join(root, relative) : root

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(absolute, { withFileTypes: true })
  } catch {
    entries = []
  }

  const folders: string[] = []
  const files: FileEntry[] = []

  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      folders.push(child)
      await walk(root, child, { into, parsed, counter, digests })
      continue
    }

    if (!entry.isFile()) continue

    counter.seen += 1
    if (counter.seen % YIELD_EVERY === 0) await yieldToLoop()

    const source = readText(path.join(absolute, entry.name))
    if (source === undefined) continue

    const file = parseFile(source, child)
    parsed.set(child, file)
    digests.set(child, createHash('sha256').update(source).digest('hex'))
    files.push({ path: child, lines: lineCount(source), ...(isCode(child) ? { code: true as const } : {}), functions: file.functions })
  }

  folders.sort((a, b) => a.localeCompare(b))
  files.sort((a, b) => a.path.localeCompare(b.path))

  into.push({ path: relative, folders, files })
}

export async function scan(root: string, digests = new Map<string, string>()): Promise<CodeMap> {
  const scannedAt = Date.now()
  const folders: FolderEntry[] = []
  const parsed = new Map<string, Parsed>()

  await walk(root, '', { into: folders, parsed, counter: { seen: 0 }, digests })
  const links = link(root, parsed)
  folders.sort((a, b) => a.path.localeCompare(b.path))

  for (const folder of folders) {
    for (const file of folder.files) {
      const { imports = [], typeImports = [], reexports = [] } = links.get(file.path) ?? {}
      if (imports.length > 0) file.imports = imports
      if (typeImports.length > 0) file.typeImports = typeImports
      if (reexports.length > 0) file.reexports = reexports
      if (parsed.get(file.path)?.computed) file.computed = true
      const starts = parsed.get(file.path)?.starts
      if (starts !== undefined && starts.length > 0) file.starts = starts
    }
  }

  return { root, scannedAt, folders }
}
