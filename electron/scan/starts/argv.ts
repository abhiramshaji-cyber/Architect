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

type Names = { lists: Set<string>; words: Set<string> }

function argvList(node: ts.Expression, names: Names): boolean {
  const value = unwrapped(node)
  if (isArgv(value)) return true
  if (ts.isIdentifier(value)) return names.lists.has(value.text)
  return (
    ts.isCallExpression(value) &&
    ts.isPropertyAccessExpression(value.expression) &&
    value.expression.name.text === 'slice' &&
    argvList(value.expression.expression, names)
  )
}

function namesIn(source: ts.SourceFile): Names {
  const names: Names = { lists: new Set(), words: new Set() }
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const value = unwrapped(node.initializer)
      if (ts.isIdentifier(node.name) && argvList(value, names)) names.lists.add(node.name.text)
      if (ts.isIdentifier(node.name) && ts.isElementAccessExpression(value) && argvList(value.expression, names)) {
        names.words.add(node.name.text)
      }
      if (ts.isArrayBindingPattern(node.name) && argvList(value, names)) {
        for (const element of node.name.elements) {
          if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) names.words.add(element.name.text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return names
}

function isWord(node: ts.Expression, names: Names): boolean {
  const value = unwrapped(node)
  if (ts.isIdentifier(value)) return names.words.has(value.text)
  return ts.isElementAccessExpression(value) && argvList(value.expression, names)
}

function compares(node: ts.Expression, names: Names): boolean {
  const value = unwrapped(node)
  if (!ts.isBinaryExpression(value)) return false
  const op = value.operatorToken.kind
  if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
    return compares(value.left, names) || compares(value.right, names)
  }
  if (op !== ts.SyntaxKind.EqualsEqualsEqualsToken && op !== ts.SyntaxKind.EqualsEqualsToken) return false
  const { left, right } = value
  return (
    (isWord(left, names) && ts.isStringLiteralLike(unwrapped(right))) ||
    (isWord(right, names) && ts.isStringLiteralLike(unwrapped(left)))
  )
}

export function commandsIn(source: ts.SourceFile): ts.Node[] {
  const names = namesIn(source)
  const bodies: ts.Node[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node) && compares(node.expression, names)) bodies.push(node.thenStatement)
    if (ts.isSwitchStatement(node) && isWord(node.expression, names)) {
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause) && ts.isStringLiteralLike(unwrapped(clause.expression))) bodies.push(clause)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return bodies
}
