import ts from 'typescript'
import { handled, unwrapped, type Code } from './refs'

const EXPOSE = new Set(['exposeInMainWorld', 'exposeInIsolatedWorld'])

function objectNamed(source: ts.SourceFile, name: string): ts.ObjectLiteralExpression | undefined {
  let hit: ts.ObjectLiteralExpression | undefined
  const visit = (node: ts.Node): void => {
    if (hit !== undefined) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      const value = unwrapped(node.initializer)
      if (ts.isObjectLiteralExpression(value)) hit = value
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return hit
}

function membersOf<T>(source: ts.SourceFile, api: ts.Node, code: Code<T>, seen: Set<ts.Node>): T[] {
  const value = ts.isExpression(api) ? unwrapped(api) : api
  const object = ts.isIdentifier(value) ? (objectNamed(source, value.text) ?? value) : value
  if (seen.has(object)) return []
  seen.add(object)
  if (!ts.isObjectLiteralExpression(object)) return handled(object, code)

  return object.properties.flatMap((property) => {
    if (code.nested.has(property)) return handled(property, code)
    if (ts.isShorthandPropertyAssignment(property)) return membersOf(source, property.name, code, seen)
    if (ts.isSpreadAssignment(property)) return membersOf(source, property.expression, code, seen)
    return ts.isPropertyAssignment(property) ? membersOf(source, property.initializer, code, seen) : []
  })
}

export function bridgedIn<T>(source: ts.SourceFile, code: Code<T>): T[] {
  const found: T[] = []
  const visit = (node: ts.Node): void => {
    const callee = ts.isCallExpression(node) ? node.expression : undefined
    const api = ts.isCallExpression(node) ? node.arguments[node.arguments.length - 1] : undefined
    if (callee && api && ts.isPropertyAccessExpression(callee) && EXPOSE.has(callee.name.text)) {
      for (const hit of membersOf(source, api, code, new Set())) if (!found.includes(hit)) found.push(hit)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}
