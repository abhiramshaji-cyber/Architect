import ts from 'typescript'
import { unwrapped } from './refs'

function isArgv(node: ts.Expression): boolean {
  const value = unwrapped(node)
  return (
    ts.isPropertyAccessExpression(value) &&
    value.name.text === 'argv' &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === 'process'
  )
}

function argvList(node: ts.Expression): boolean {
  const value = unwrapped(node)
  if (isArgv(value)) return true
  return (
    ts.isCallExpression(value) &&
    ts.isPropertyAccessExpression(value.expression) &&
    value.expression.name.text === 'slice' &&
    isArgv(value.expression.expression)
  )
}

function aliasesIn(source: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const value = unwrapped(node.initializer)
      if (ts.isIdentifier(node.name) && ts.isElementAccessExpression(value) && argvList(value.expression)) {
        names.add(node.name.text)
      }
      if (ts.isArrayBindingPattern(node.name) && argvList(value)) {
        for (const element of node.name.elements) {
          if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) names.add(element.name.text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return names
}

function isWord(node: ts.Expression, aliases: Set<string>): boolean {
  const value = unwrapped(node)
  if (ts.isIdentifier(value)) return aliases.has(value.text)
  return ts.isElementAccessExpression(value) && argvList(value.expression)
}

function compares(node: ts.Expression, aliases: Set<string>): boolean {
  const value = unwrapped(node)
  if (!ts.isBinaryExpression(value)) return false
  const op = value.operatorToken.kind
  if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
    return compares(value.left, aliases) || compares(value.right, aliases)
  }
  if (op !== ts.SyntaxKind.EqualsEqualsEqualsToken && op !== ts.SyntaxKind.EqualsEqualsToken) return false
  const { left, right } = value
  return (
    (isWord(left, aliases) && ts.isStringLiteralLike(unwrapped(right))) ||
    (isWord(right, aliases) && ts.isStringLiteralLike(unwrapped(left)))
  )
}

export function commandsIn(source: ts.SourceFile): ts.Node[] {
  const aliases = aliasesIn(source)
  const bodies: ts.Node[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node) && compares(node.expression, aliases)) bodies.push(node.thenStatement)
    if (ts.isSwitchStatement(node) && isWord(node.expression, aliases)) {
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause) && ts.isStringLiteralLike(unwrapped(clause.expression))) bodies.push(clause)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return bodies
}
