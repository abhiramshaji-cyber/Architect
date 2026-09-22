import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { CallRef, CodeMap, FileEntry, FolderEntry, FunctionEntry } from '../../shared/types'

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

  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? 'default'
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

function ownerFor(node: ts.Node, owner: string): string {
  if (ts.isClassLike(node)) return node.name?.text ?? owner
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text
  if (ts.isObjectLiteralExpression(node)) return owner

  if (ts.isPropertyAssignment(node)) {
    const name = propertyName(node.name)
    if (name === undefined) return ''
    return owner ? `${owner}.${name}` : name
  }

  return ''
}

function calleeName(expression: ts.Expression, self: string): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return self === '' ? undefined : self
  if (ts.isParenthesizedExpression(expression)) return calleeName(expression.expression, self)

  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    const base = calleeName(expression.expression, self)
    return base === undefined ? undefined : `${base}.${expression.name.text}`
  }

  return undefined
}

type Found = { entry: FunctionEntry; node: ts.Node; owner: string }

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

function bindingsOf(found: Found[]): Map<ts.Node, Map<string, number>> {
  const byScope = new Map<ts.Node, Map<string, number>>()

  for (const [i, f] of found.entries()) {
    const scope = scopeOf(f.node)
    if (scope === undefined) continue

    const names = byScope.get(scope) ?? new Map<string, number>()
    byScope.set(scope, names)

    const prev = names.get(f.entry.name)
    const previous = prev === undefined ? undefined : found[prev]
    if (previous === undefined || !isOverloadSignature(f.node) || isOverloadSignature(previous.node)) {
      names.set(f.entry.name, i)
    }
  }

  return byScope
}

type Call = number | { name: string; root: string }

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

function callsIn(
  node: ts.Node,
  self: string,
  nested: Set<ts.Node>,
  resolve: (name: string, at: ts.Node) => Call | undefined,
): Call[] {
  const found = new Map<string, Call>()

  const visit = (child: ts.Node): void => {
    if (child !== node && nested.has(child)) return

    if (ts.isCallExpression(child)) {
      const name = calleeName(child.expression, self)
      const target = name === undefined ? undefined : resolve(name, child)
      if (target !== undefined) found.set(typeof target === 'number' ? `#${target}` : `@${target.name}`, target)
    }

    ts.forEachChild(child, visit)
  }

  visit(node)
  return [...found.values()]
}

type Pending = { from: number; spec: string; key: string }

type Parsed = {
  functions: FunctionEntry[]
  topLevel: Map<string, number>
  exports: Map<string, string>
  reexports: Map<string, { spec: string; name: string }>
  stars: string[]
  pending: Pending[]
}

function empty(): Parsed {
  return { functions: [], topLevel: new Map(), exports: new Map(), reexports: new Map(), stars: [], pending: [] }
}

function parseFile(source: string, file: string): Parsed {
  const lower = file.toLowerCase()
  if (lower.endsWith('.d.ts') || lower.endsWith('.d.mts') || lower.endsWith('.d.cts')) return empty()

  const kind = SCRIPT_KINDS.get(path.extname(lower))
  if (kind === undefined) return empty()

  try {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
    const found: Found[] = []

    const visit = (node: ts.Node, owner: string): void => {
      const name = declaredName(node, owner)
      if (name !== undefined) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
        const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1
        found.push({ entry: { name, line, endLine, description: '', calls: [] }, node, owner })
      }

      const next = ownerFor(node, owner)
      ts.forEachChild(node, (child) => visit(child, next))
    }

    ts.forEachChild(sourceFile, (child) => visit(child, ''))

    const nested = new Set(found.map((f) => f.node))
    const byScope = bindingsOf(found)
    const shadows = shadowsOf(sourceFile)
    const imported = importBindings(sourceFile)
    const calls = found.map((f) =>
      callsIn(f.node, f.owner, nested, (name, at) => resolveCall(name, at, byScope, shadows, imported)),
    )

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

    const pending: Pending[] = []
    const functions = order.map(({ f, i }, from) => {
      const refs: CallRef[] = []
      for (const call of calls[i] ?? []) {
        if (typeof call === 'number') {
          const to = rank.get(call)
          if (to !== undefined) refs.push({ file, fn: to })
          continue
        }

        const binding = imported.get(call.root)
        if (binding === null || binding === undefined) continue

        const rest = call.name.slice(call.root.length)
        const key = binding.name === null ? rest.slice(1) : binding.name + rest
        if (key !== '') pending.push({ from, spec: binding.spec, key })
      }

      return { ...f.entry, calls: refs.sort((a, b) => a.fn - b.fn) }
    })

    return { functions, topLevel, exports, reexports, stars, pending }
  } catch {
    return empty()
  }
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

function link(root: string, parsed: Map<string, Parsed>): void {
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
        via === undefined || to === undefined
          ? undefined
          : find(to, via.name === '*' ? rest.slice(1) : via.name + rest, seen)
      if (hit !== undefined) return hit
    }

    for (const spec of at.stars) {
      const to = target(file, spec)
      const hit = to === undefined ? undefined : find(to, key, seen)
      if (hit !== undefined) return hit
    }

    return undefined
  }

  for (const [file, at] of parsed) {
    for (const { from, spec, key } of at.pending) {
      const entry = at.functions[from]
      const to = target(file, spec)
      const hit = to === undefined || entry === undefined ? undefined : find(to, key, new Set())
      if (hit === undefined || entry === undefined) continue
      if (entry.calls.some((c) => c.file === hit.file && c.fn === hit.fn)) continue
      entry.calls.push(hit)
    }

    for (const entry of at.functions) {
      entry.calls.sort((a, b) => a.file.localeCompare(b.file) || a.fn - b.fn)
    }
  }
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

async function walk(
  root: string,
  relative: string,
  into: FolderEntry[],
  parsed: Map<string, Parsed>,
  counter: { seen: number },
): Promise<void> {
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
      await walk(root, child, into, parsed, counter)
      continue
    }

    if (!entry.isFile()) continue

    counter.seen += 1
    if (counter.seen % YIELD_EVERY === 0) await yieldToLoop()

    const source = readText(path.join(absolute, entry.name))
    if (source === undefined) continue

    const file = parseFile(source, child)
    parsed.set(child, file)
    files.push({ path: child, functions: file.functions })
  }

  folders.sort((a, b) => a.localeCompare(b))
  files.sort((a, b) => a.path.localeCompare(b.path))

  into.push({ path: relative, folders, files })
}

export async function scan(root: string): Promise<CodeMap> {
  const folders: FolderEntry[] = []
  const parsed = new Map<string, Parsed>()

  await walk(root, '', folders, parsed, { seen: 0 })
  link(root, parsed)
  folders.sort((a, b) => a.path.localeCompare(b.path))

  return { root, scannedAt: Date.now(), folders }
}
