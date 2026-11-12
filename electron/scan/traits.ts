import ts from 'typescript'
import type { Param, Signature } from '../../shared/types'

function anchorOf(node: ts.Node): ts.Node {
  const list = node.parent
  if (!ts.isVariableDeclaration(node) || !ts.isVariableDeclarationList(list)) return node
  return list.declarations[0] === node && ts.isVariableStatement(list.parent) ? list.parent : node
}

function adjacent(node: ts.Node, source: ts.SourceFile): ts.CommentRange[] {
  const lineOf = (at: number) => source.getLineAndCharacterOfPosition(at).line
  const ranges = ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? []
  const kept: ts.CommentRange[] = []
  let below = lineOf(node.getStart(source))
  for (const range of [...ranges].reverse()) {
    if (lineOf(range.end) !== below - 1) break
    kept.unshift(range)
    below = lineOf(range.pos)
  }
  return kept
}

function docText(raw: string): string {
  const rows = raw
    .slice(3, -2)
    .split(/\r?\n/)
    .map((row) => row.replace(/^\s*\* ?/, '').trimEnd())
  const indents = rows.filter((row) => row.trim() !== '').map((row) => /^[ \t]*/.exec(row)?.[0].length ?? 0)
  const cut = indents.length === 0 ? 0 : Math.min(...indents)
  return rows
    .map((row) => row.slice(cut))
    .join('\n')
    .replace(/^\n+|\s+$/g, '')
}

export function docOf(node: ts.Node, source: ts.SourceFile): string | undefined {
  const text = adjacent(anchorOf(node), source)
    .map((range) => source.text.slice(range.pos, range.end))
    .filter((raw) => /^\/\*\*[^/]/.test(raw))
    .map(docText)
    .filter((doc) => doc !== '')
    .join('\n\n')
  return text === '' ? undefined : text
}

function callableOf(node: ts.Node | undefined): ts.SignatureDeclaration | undefined {
  return node !== undefined && ts.isFunctionLike(node) ? node : undefined
}

function declaredFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node))
    return callableOf(node.initializer)
  if (ts.isExportAssignment(node)) return callableOf(node.expression)
  return callableOf(node)
}

function written(node: ts.Node, source: ts.SourceFile): string {
  return node.getText(source).replace(/\s*\n\s*/g, ' ').trim()
}

function paramOf(param: ts.ParameterDeclaration, source: ts.SourceFile): Param {
  const found: Param = { name: written(param.name, source) }
  if (param.dotDotDotToken) found.rest = true
  if (param.questionToken) found.optional = true
  if (param.type) found.type = written(param.type, source)
  if (param.initializer) found.value = written(param.initializer, source)
  return found
}

export function signatureOf(node: ts.Node, source: ts.SourceFile): Signature | undefined {
  const fn = declaredFunction(node)
  if (fn === undefined) return undefined
  const signature: Signature = { params: fn.parameters.map((param) => paramOf(param, source)) }
  if (fn.typeParameters && fn.typeParameters.length > 0)
    signature.generics = fn.typeParameters.map((type) => written(type, source)).join(', ')
  if (fn.type) signature.returns = written(fn.type, source)
  return signature
}

export function renderedTag(node: ts.Node): ts.Expression | undefined {
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return undefined
  const tag = node.tagName
  if (ts.isIdentifier(tag)) return /^[a-z]|-/.test(tag.text) ? undefined : tag
  return ts.isPropertyAccessExpression(tag) ? tag : undefined
}
