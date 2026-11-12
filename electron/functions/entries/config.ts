import path from 'node:path'
import ts from 'typescript'

export type Value = ts.Expression | undefined

const HERE = new Set(['__dirname', 'dirname', 'cwd'])

function bare(node: ts.Expression): ts.Expression {
  let at = node
  while (ts.isParenthesizedExpression(at) || ts.isAsExpression(at) || ts.isSatisfiesExpression(at)) at = at.expression
  return at
}

function declared(source: ts.SourceFile, name: string): Value {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration.initializer
    }
  }
  return undefined
}

export function valueOf(source: ts.SourceFile, node: Value, seen = new Set<string>()): Value {
  if (node === undefined) return undefined
  const value = bare(node)
  if (!ts.isIdentifier(value) || seen.has(value.text)) return value
  seen.add(value.text)
  return valueOf(source, declared(source, value.text), seen)
}

function returned(fn: ts.ArrowFunction | ts.FunctionExpression): Value {
  if (!ts.isBlock(fn.body)) return fn.body
  const last = fn.body.statements.find(ts.isReturnStatement)
  return last?.expression
}

export function configOf(source: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  let exported: Value
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) exported = statement.expression
    if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.left.getText(source) === 'module.exports'
    ) {
      exported = statement.expression.right
    }
  }

  let value = valueOf(source, exported)
  for (let depth = 0; value !== undefined && depth < 4; depth++) {
    if (ts.isObjectLiteralExpression(value)) return value
    if (ts.isCallExpression(value)) value = valueOf(source, value.arguments[0])
    else if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) value = valueOf(source, returned(value))
    else return undefined
  }
  return undefined
}

export function field(source: ts.SourceFile, object: Value, ...keys: string[]): Value {
  let at = valueOf(source, object)
  for (const key of keys) {
    if (at === undefined || !ts.isObjectLiteralExpression(at)) return undefined
    const hit = at.properties.find((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === key)
    if (hit === undefined) return undefined
    at = ts.isPropertyAssignment(hit)
      ? valueOf(source, hit.initializer)
      : ts.isShorthandPropertyAssignment(hit)
        ? valueOf(source, hit.name)
        : undefined
  }
  return at
}

function segment(node: ts.Expression): string | null | undefined {
  const value = bare(node)
  if (ts.isStringLiteralLike(value)) return value.text
  const text = ts.isPropertyAccessExpression(value) ? value.name.text : ts.isIdentifier(value) ? value.text : ''
  if (HERE.has(text)) return null
  if (ts.isCallExpression(value) && HERE.has(ts.isPropertyAccessExpression(value.expression) ? value.expression.name.text : '')) return null
  return undefined
}

export function pathOf(source: ts.SourceFile, node: Value): string | undefined {
  const value = valueOf(source, node)
  if (value === undefined) return undefined
  const direct = segment(value)
  if (typeof direct === 'string') return path.posix.normalize(direct)
  if (ts.isNewExpression(value) && value.expression.getText(source) === 'URL') return pathOf(source, value.arguments?.[0])
  if (!ts.isCallExpression(value)) return undefined

  const callee = ts.isPropertyAccessExpression(value.expression) ? value.expression.name.text : value.expression.getText(source)
  if (callee === 'fileURLToPath') return pathOf(source, value.arguments[0])
  if (callee !== 'resolve' && callee !== 'join') return undefined
  const parts = value.arguments.map(segment)
  if (parts.some((part) => part === undefined)) return undefined
  return path.posix.normalize(parts.filter((part) => typeof part === 'string').join('/') || '.')
}

export function pathsOf(source: ts.SourceFile, node: Value): { name: string | null; file: string }[] {
  const value = valueOf(source, node)
  if (value === undefined) return []
  if (ts.isArrayLiteralExpression(value)) return value.elements.flatMap((element) => pathsOf(source, element))
  if (ts.isObjectLiteralExpression(value)) {
    return value.properties.flatMap((p) => {
      const file = ts.isPropertyAssignment(p) ? pathOf(source, p.initializer) : undefined
      const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) ? p.name.text : null
      return file === undefined ? [] : [{ name, file }]
    })
  }
  const file = pathOf(source, value)
  return file === undefined ? [] : [{ name: null, file }]
}
