import ts from 'typescript'
import { renderedTag } from '../traits'

export type Call = number | { name: string; root: string }

export type Resolve = (expression: ts.Expression, at: ts.Node) => Call | undefined

export type Site = { call: Call; line: number } | { bridge: string; line: number }

export type Code = { nested: Set<ts.Node>; resolve: Resolve; local: (node: ts.Node) => Call | undefined; sites: (node: ts.Node) => Site[] }

export function lineOf(node: ts.Node): number {
  const source = node.getSourceFile()
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
}

export function unwrapped(node: ts.Expression): ts.Expression {
  let at = node
  while (
    ts.isParenthesizedExpression(at) ||
    ts.isAsExpression(at) ||
    ts.isSatisfiesExpression(at) ||
    ts.isNonNullExpression(at) ||
    ts.isTypeAssertionExpression(at)
  ) {
    at = at.expression
  }
  return at
}

export function isInline(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}

function isReference(node: ts.Expression): boolean {
  return ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)
}

export function refsIn(node: ts.Node, code: Code): Call[] {
  const found: Call[] = []
  const add = (expression: ts.Expression, at: ts.Node) => {
    const hit = code.resolve(expression, at)
    if (hit !== undefined && !found.includes(hit)) found.push(hit)
  }

  const visit = (child: ts.Node): void => {
    if (child !== node && code.nested.has(child)) return

    const callee = ts.isCallExpression(child) || ts.isNewExpression(child) ? child.expression : renderedTag(child)
    if (callee !== undefined) add(callee, child)

    // callbacks
    const passed = ts.isCallExpression(child) || ts.isNewExpression(child) ? (child.arguments ?? []) : []
    for (const arg of passed) {
      const value = unwrapped(arg)
      if (isReference(value)) add(value, child)
    }
    if (ts.isJsxExpression(child) && child.expression && isReference(unwrapped(child.expression))) {
      add(unwrapped(child.expression), child)
    }

    ts.forEachChild(child, visit)
  }

  visit(node)
  return found
}

export function handled(handler: ts.Node, code: Code): Call[] {
  if (code.nested.has(handler)) {
    const self = code.local(handler)
    return self === undefined ? [] : [self]
  }
  if (!ts.isExpression(handler)) return []
  const value = unwrapped(handler)
  if (isInline(value) || ts.isCallExpression(value)) return refsIn(value, code)
  const hit = isReference(value) ? code.resolve(value, value) : undefined
  return hit === undefined ? [] : [hit]
}

export function handlerSites(handler: ts.Node, code: Code, at: ts.Node): Site[] {
  const line = lineOf(at)
  if (code.nested.has(handler)) {
    const self = code.local(handler)
    return self === undefined ? [] : [{ call: self, line }]
  }
  if (!ts.isExpression(handler)) return []
  const value = unwrapped(handler)
  if (isInline(value) || ts.isCallExpression(value)) return code.sites(value)
  const hit = isReference(value) ? code.resolve(value, value) : undefined
  return hit === undefined ? [] : [{ call: hit, line }]
}
