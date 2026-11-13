import ts from 'typescript'
import type { Call } from './starts'
import { renderedTag } from './traits'

export type Value = Call | { spec: string }

export type Lookup = {
  resolve: (name: string, at: ts.Node) => Call | undefined
  members: (name: string, at: ts.Node) => Call[]
  local: (node: ts.Node) => number | undefined
}

const BOUND = new Set(['call', 'apply', 'bind'])

function isSkipped(node: ts.Node): boolean {
  return (
    ts.isImportDeclaration(node) ||
    ts.isImportEqualsDeclaration(node) ||
    ts.isExportDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    (ts.isExportAssignment(node) && ts.isIdentifier(node.expression)) ||
    (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node))
  )
}

function isNamed(node: ts.Node): boolean {
  const parent = node.parent as ts.Node & { name?: ts.Node; propertyName?: ts.Node; label?: ts.Node }
  if (ts.isShorthandPropertyAssignment(parent)) return false
  if (ts.isJsxClosingElement(parent)) return true
  return parent.name === node || parent.propertyName === node || parent.label === node
}

function isCallee(node: ts.Node): boolean {
  const parent = node.parent
  return (ts.isCallExpression(parent) && parent.expression === node) || renderedTag(parent) === node
}

function isNamedObject(node: ts.ObjectLiteralExpression): boolean {
  const parent = node.parent
  if (ts.isVariableDeclaration(parent)) return ts.isIdentifier(parent.name)
  return ts.isPropertyAssignment(parent) && ts.isObjectLiteralExpression(parent.parent) && isNamedObject(parent.parent)
}

function patternOf(node: ts.Expression | undefined, plain = (text: string) => text): string | undefined {
  if (node === undefined) return undefined
  if (ts.isStringLiteralLike(node)) return plain(node.text)
  if (ts.isTemplateExpression(node)) return plain(node.head.text) + node.templateSpans.map((span) => `*${plain(span.literal.text)}`).join('')
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.PlusToken) return undefined
  const head = patternOf(node.left, plain)
  return head === undefined ? undefined : `${head}*`
}

const escaped = (text: string) => text.replace(/[[\]{}?*\\]/g, '\\$&')

function loaded(node: ts.Node): string[] {
  if (!ts.isCallExpression(node)) return []
  const [first] = node.arguments
  if (/^import\.meta\.glob/.test(node.expression.getText())) {
    const globs = first !== undefined && ts.isArrayLiteralExpression(first) ? [...first.elements] : [first]
    return globs.flatMap((glob) => patternOf(glob) ?? []).filter((glob) => !glob.startsWith('!'))
  }
  const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword
  const required = ts.isIdentifier(node.expression) && node.expression.text === 'require'
  if (!dynamic && !required) return []
  return [patternOf(first, escaped) ?? '']
}

function chainOf(root: ts.Node, self: string): { names: string[]; top: ts.Node } {
  const names = [ts.isIdentifier(root) ? root.text : self]
  let top = root
  while (ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) {
    top = top.parent
    names.push(`${names[names.length - 1]}.${(top as ts.PropertyAccessExpression).name.text}`)
  }
  return { names, top }
}

function valuesAt(root: ts.Node, self: string, { resolve, members }: Lookup): Call[] {
  const { names, top } = chainOf(root, self)
  if (names[0] === '') return []
  const called = isCallee(top)
  const rendered = renderedTag(top.parent) === top
  const last = names.length - 1
  const hits = names.map((name) => resolve(name, root))
  let deepest = last
  while (deepest >= 0 && hits[deepest] === undefined) deepest--
  const tail = ts.isPropertyAccessExpression(top) ? top.name.text : ''
  const bound = called && BOUND.has(tail) ? hits[last - 1] : undefined

  const found: Call[] = []
  if (deepest >= 0 && (!called || deepest < last)) found.push(hits[deepest] as Call)
  if (bound !== undefined) found.push(bound)
  if (!called || rendered) found.push(...members(names[last] ?? '', root))
  return found
}

const keyOf = (value: Value) =>
  typeof value === 'number' ? `#${value}` : 'spec' in value ? `!${value.spec}` : `@${value.name}`

function valuesIn(node: ts.Node, self: string, nested: Set<ts.Node>, lookup: Lookup): Value[] {
  const found = new Map<string, Value>()
  const add = (value: Value) => found.set(keyOf(value), value)

  const visit = (child: ts.Node): void => {
    if ((child !== node && nested.has(child)) || isSkipped(child)) return
    for (const spec of loaded(child)) add({ spec })
    const passedClass = ts.isClassExpression(child) && !ts.isVariableDeclaration(child.parent)
    const decorated = ts.isClassLike(child) && (ts.getDecorators(child)?.length ?? 0) > 0
    if ((ts.isObjectLiteralExpression(child) && !isNamedObject(child)) || passedClass || decorated) {
      for (const property of ts.isObjectLiteralExpression(child) ? child.properties : (child as ts.ClassLikeDeclaration).members) {
        const fn = lookup.local(property)
        if (fn !== undefined) add(fn)
      }
    }
    const root = ts.isIdentifier(child) || child.kind === ts.SyntaxKind.ThisKeyword
    const parent = child.parent as ts.Node | undefined
    const member = parent !== undefined && ts.isPropertyAccessExpression(parent) && parent.name === child
    if (root && parent !== undefined && !member && !isNamed(child)) valuesAt(child, self, lookup).forEach(add)
    ts.forEachChild(child, visit)
  }

  visit(node)
  return [...found.values()]
}

type Binding = { spec: string; name: string | null } | null

export function usedIn(
  bodies: { node: ts.Node; self: string }[],
  nested: Set<ts.Node>,
  lookup: Lookup,
  imported: Map<string, Binding>,
): { used: number[]; linked: { spec: string; key: string }[]; computed: boolean } {
  const values = bodies.flatMap(({ node, self }) => valuesIn(node, self, nested, lookup))
  const used = [...new Set(values.flatMap((value) => (typeof value === 'number' ? [value] : [])))]
  const linked = values.flatMap((value) => {
    if (typeof value === 'number') return []
    if ('spec' in value) return value.spec === '' ? [] : [{ spec: value.spec, key: '' }]
    const binding = imported.get(value.root)
    const rest = value.name.slice(value.root.length)
    return binding ? [{ spec: binding.spec, key: binding.name === null ? rest.slice(1) : binding.name + rest }] : []
  })
  return { used, linked, computed: values.some((value) => typeof value === 'object' && 'spec' in value && value.spec === '') }
}
