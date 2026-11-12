import ts from 'typescript'
import type { ExtractPoint, FunctionEntry } from '../../../shared/types'

const COMPOUND = new Map<ts.SyntaxKind, string>([
  [ts.SyntaxKind.IfStatement, 'if'],
  [ts.SyntaxKind.ForStatement, 'for'],
  [ts.SyntaxKind.ForOfStatement, 'for of'],
  [ts.SyntaxKind.ForInStatement, 'for in'],
  [ts.SyntaxKind.WhileStatement, 'while'],
  [ts.SyntaxKind.DoStatement, 'do while'],
  [ts.SyntaxKind.SwitchStatement, 'switch'],
  [ts.SyntaxKind.TryStatement, 'try'],
  [ts.SyntaxKind.Block, 'block'],
  [ts.SyntaxKind.LabeledStatement, 'labeled'],
])

type Span = { line: number; endLine: number }

function spanOf(node: ts.Node, source: ts.SourceFile): Span {
  return {
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    endLine: source.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
  }
}

function unwrapped(node: ts.Node | undefined): ts.Node | undefined {
  let at = node
  while (at && (ts.isParenthesizedExpression(at) || ts.isAsExpression(at) || ts.isSatisfiesExpression(at) || ts.isAwaitExpression(at) || ts.isVoidExpression(at))) at = at.expression
  return at
}

function blockOf(node: ts.Node): ts.Block | undefined {
  const value = ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node) ? unwrapped(node.initializer) : ts.isExportAssignment(node) ? unwrapped(node.expression) : node
  if (value && ts.isFunctionLike(value) && 'body' in value && value.body && ts.isBlock(value.body)) return value.body
  return undefined
}

function bodyAt(source: ts.SourceFile, fn: FunctionEntry): ts.Block | undefined {
  let found: ts.Block | undefined
  const visit = (node: ts.Node): void => {
    if (found) return
    const span = spanOf(node, source)
    if (span.line > fn.line || span.endLine < fn.endLine) return
    if (span.line === fn.line && span.endLine === fn.endLine) found = blockOf(node)
    if (!found) ts.forEachChild(node, visit)
  }
  ts.forEachChild(source, visit)
  return found
}

function calleeOf(statement: ts.Statement): string | undefined {
  const values = ts.isExpressionStatement(statement)
    ? [statement.expression]
    : ts.isReturnStatement(statement)
      ? [statement.expression]
      : ts.isVariableStatement(statement)
        ? statement.declarationList.declarations.map((declaration) => declaration.initializer)
        : []
  for (const value of values.map(unwrapped)) {
    if (!value || !(ts.isCallExpression(value) || ts.isNewExpression(value))) continue
    const callback = (value.arguments ?? []).some((arg) => (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) && ts.isBlock(arg.body))
    if (callback) return ts.isIdentifier(value.expression) || ts.isPropertyAccessExpression(value.expression) ? value.expression.getText().replace(/\s+/g, '') : 'call'
  }
  return undefined
}

function statementPoint(statement: ts.Statement, source: ts.SourceFile): ExtractPoint | undefined {
  const span = spanOf(statement, source)
  if (span.endLine === span.line) return undefined
  const lines = span.endLine - span.line + 1
  const kind = COMPOUND.get(statement.kind)
  if (kind) return { kind, label: kind, ...span, lines }
  const callee = calleeOf(statement)
  return callee === undefined ? undefined : { kind: 'callback', label: `${callee} callback`, ...span, lines }
}

function innerOf(fn: FunctionEntry, functions: FunctionEntry[]): FunctionEntry[] {
  const within = (inner: FunctionEntry, outer: FunctionEntry) =>
    outer.line <= inner.line && inner.endLine <= outer.endLine && (outer.line < inner.line || inner.endLine < outer.endLine)
  const inside = functions.filter((other) => within(other, fn))
  return inside.filter((inner) => !inside.some((outer) => within(inner, outer)))
}

export function pointsOf(source: ts.SourceFile | undefined, fn: FunctionEntry, all: FunctionEntry[]): ExtractPoint[] | string {
  const functions = innerOf(fn, all).map(({ name, line, endLine }) => ({ kind: 'function', label: name, line, endLine, lines: endLine - line + 1 }))
  const body = source && bodyAt(source, fn)
  if (!body) return functions.length > 0 ? functions : 'no block body found in the parse'
  if (body.statements.length < 2) return functions.length > 0 ? functions : 'the body is one statement'

  const statements = body.statements.flatMap((statement) => {
    const point = source && statementPoint(statement, source)
    if (!point || functions.some((inner) => inner.line === point.line && inner.endLine === point.endLine)) return []
    return [point]
  })
  const points = [...functions, ...statements].sort((a, b) => a.line - b.line)
  return points.length > 0 ? points : 'no compound statement, callback or inner function in the body'
}
