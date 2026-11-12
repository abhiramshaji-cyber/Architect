import ts from 'typescript'
import { functionsIn } from '../scan/scan'

export type Change = { name: string; key: string; line: number; change: 'added' | 'changed' | 'removed'; shares: string[] }

type Span = { name: string; line: number; endLine: number }

type Body = { name: string; key: string; line: number; endLine: number; text: string; words: Set<string> }

const ORDER: Change['change'][] = ['changed', 'removed', 'added']

const holds = (outer: Span, inner: Span) => outer.endLine > inner.endLine || (outer.endLine === inner.endLine && outer.line < inner.line && inner.line < outer.endLine)

export function keysOf(fns: Span[]): string[] {
  const open: (Span & { key: string })[] = []
  const seen = new Map<string, number>()
  return fns.map((fn) => {
    while (open.length > 0 && !holds(open.at(-1) as Span, fn)) open.pop()
    const base = `${open.at(-1)?.key ?? ''}/${fn.name}`
    const nth = seen.get(base) ?? 0
    seen.set(base, nth + 1)
    const key = `${base}#${nth}`
    open.push({ ...fn, key })
    return key
  })
}

function bodies(source: string, file: string): Map<string, Body> {
  const lines = source.split(/\r?\n/)
  const fns = functionsIn(source, file)
  const keys = keysOf(fns)
  return new Map(
    fns.map((fn, i) => {
      const key = keys[i] ?? ''
      const inner = fns.filter((_, j) => (keys[j] ?? '').startsWith(`${key}/`))
      const own = (line: number) => !inner.some((child) => child.line < line && line < child.endLine)
      const text = tokens(lines.slice(fn.line - 1, fn.endLine).filter((_, at) => own(fn.line + at)).join('\n'))
      return [key, { name: fn.name, key, line: fn.line, endLine: fn.endLine, text, words: new Set(text.split(' ')) }]
    }),
  )
}

function sharing(all: Map<string, Body>, body: Body): string[] {
  const related = (other: Body) => other.key.startsWith(`${body.key}/`) || body.key.startsWith(`${other.key}/`)
  return [...all.values()].filter((other) => other !== body && !related(other) && other.line <= body.endLine && body.line <= other.endLine).map((other) => other.name)
}

function tokens(text: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text)
  const found: string[] = []
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) found.push(kind === ts.SyntaxKind.StringLiteral ? JSON.stringify(scanner.getTokenValue()) : scanner.getTokenText())
  return found.join(' ')
}

function shape(node: ts.Node, source: ts.SourceFile, named: Set<number>): string {
  const scanned = ts.isFunctionLike(node) && named.has(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)
  const body = scanned ? (node as { body?: ts.Node }).body : undefined
  const kids = node.getChildren(source)
  if (kids.length === 0) return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? JSON.stringify(node.text) : node.getText(source)
  return kids.filter((kid) => kid !== body).map((kid) => shape(kid, source, named)).join(' ')
}

const isFunction = (node: ts.Node | undefined) => node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node))

const KINDS: [RegExp, ts.ScriptKind][] = [[/\.tsx$/i, ts.ScriptKind.TSX], [/\.[cm]?ts$/i, ts.ScriptKind.TS], [/\.([cm]?js|jsx)$/i, ts.ScriptKind.JSX]]

export const sourceOf = (file: string, text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, KINDS.find(([test]) => test.test(file))?.[1] ?? ts.ScriptKind.TS)

function bound(name: ts.BindingName): string[] {
  return ts.isIdentifier(name) ? [name.text] : name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : bound(element.name)))
}

type Declared = { kind: 'function' } | { kind: 'export'; names: string[] } | { kind: 'local'; bindings: [string, string][] } | { kind: 'module' } | { kind: 'code' }

function declared(statement: ts.Statement): Declared {
  if (ts.isFunctionDeclaration(statement)) return { kind: 'function' }
  if (ts.isVariableStatement(statement)) {
    const list = statement.declarationList.declarations
    return list.every((one) => isFunction(one.initializer)) ? { kind: 'function' } : { kind: 'export', names: list.flatMap((one) => bound(one.name)) }
  }
  if ((ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) return { kind: 'export', names: [statement.name.text] }
  if (ts.isExportAssignment(statement)) return { kind: 'export', names: ['default'] }
  if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) return { kind: 'export', names: statement.exportClause.elements.map((element) => element.name.text) }
  const clause = ts.isImportDeclaration(statement) ? statement.importClause : undefined
  if (ts.isExportDeclaration(statement) || (ts.isImportDeclaration(statement) && !clause)) return { kind: 'module' }
  if (!clause) return { kind: 'code' }
  const from = ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : ''
  const space: [string, string][] = clause.namedBindings && ts.isNamespaceImport(clause.namedBindings) ? [[clause.namedBindings.name.text, `${from} *`]] : []
  const named: [string, string][] = clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.map((element) => [element.name.text, `${from} ${(element.propertyName ?? element.name).text}`]) : []
  return { kind: 'local', bindings: [...(clause.name ? ([[clause.name.text, `${from} default`]] as [string, string][]) : []), ...space, ...named] }
}

function topLevel(text: string, file: string): { declared: Map<string, string>; local: Map<string, string>; module: string[]; code: string[] } {
  const source = sourceOf(file, text)
  const named = new Set(functionsIn(text, file).map((fn) => fn.line))
  const [declaredNames, local, module, code] = [new Map<string, string>(), new Map<string, string>(), [] as string[], [] as string[]]
  for (const statement of source.statements) {
    const found = declared(statement)
    if (found.kind === 'function') continue
    if (found.kind === 'module') module.push(shape(statement, source, named))
    else if (found.kind === 'code') code.push(shape(statement, source, named))
    else if (found.kind === 'local') for (const [name, from] of found.bindings) local.set(name, from)
    else for (const name of found.names) declaredNames.set(name, shape(statement, source, named))
  }
  return { declared: declaredNames, local, module: module.sort(), code: code.sort() }
}

export type Outside = { names: string[]; locals: string[]; code: boolean } | 'all'

function outsideOf(file: string, before: string, after: string): Outside {
  const [old, next] = [topLevel(before, file), topLevel(after, file)]
  if (old.module.join('\n') !== next.module.join('\n')) return 'all'
  const differ = (a: Map<string, string>, b: Map<string, string>, kept: boolean) => [...new Set([...a.keys(), ...b.keys()])].filter((name) => a.get(name) !== b.get(name) && (!kept || a.has(name))).sort()
  return { names: differ(old.declared, next.declared, false), locals: differ(old.local, next.local, true), code: old.code.join('\n') !== next.code.join('\n') }
}

export function changesOf(file: string, before: string, after: string): { changes: Change[]; parsed: number; outside: Outside; uses: (names: string[]) => string[] } {
  const old = bodies(before, file)
  const next = bodies(after, file)
  const change = (all: Map<string, Body>, body: Body, kind: Change['change']): Change => ({ name: body.name, key: body.key, line: body.line, change: kind, shares: sharing(all, body) })

  const edited = [...next.values()].flatMap((body): Change[] => {
    const was = old.get(body.key)
    if (!was) return [change(next, body, 'added')]
    return was.text === body.text ? [] : [change(old, was, 'changed')]
  })
  const removed = [...old.values()].flatMap((body): Change[] => (next.has(body.key) ? [] : [change(old, body, 'removed')]))

  const order = (entry: Change) => ORDER.indexOf(entry.change)
  return { changes: [...edited, ...removed].sort((a, b) => order(a) - order(b) || a.line - b.line || a.name.localeCompare(b.name)), parsed: old.size + next.size, outside: outsideOf(file, before, after), uses: (names) => [...next.values()].filter((body) => names.some((name) => body.words.has(name))).map((body) => body.key) }
}
