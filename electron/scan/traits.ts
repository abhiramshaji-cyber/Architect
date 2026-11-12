import ts from 'typescript'
import type { Param, Signature } from '../../shared/types'

const DIRECTIVE =
  /^(eslint[\s-]|eslint$|global\s|oxlint-|prettier-ignore|istanbul ignore|c8 ignore|biome-ignore|tslint:|jshint\s|jscs:|@ts-|#region|#endregion|#!|<reference|@jsx|spdx-license-identifier)/i

type Comment = { line: boolean; doc: boolean; text: string }

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

function commentOf(range: ts.CommentRange, source: ts.SourceFile): Comment {
  const raw = source.text.slice(range.pos, range.end)
  const line = range.kind === ts.SyntaxKind.SingleLineCommentTrivia
  const inner = line ? raw.replace(/^\/+ ?/, '') : raw.slice(2, -2)
  const text = line
    ? inner.trimEnd()
    : inner
        .split(/\r?\n/)
        .map((row) => row.replace(/^\s*\* ?/, '').trimEnd())
        .join('\n')
  return { line, doc: !line && /^\/\*\*[^/]/.test(raw), text }
}

function dedented(text: string): string {
  const rows = text.split('\n')
  const indents = rows.filter((row) => row.trim() !== '').map((row) => /^[ \t]*/.exec(row)?.[0].length ?? 0)
  const cut = indents.length === 0 ? 0 : Math.min(...indents)
  return rows
    .map((row) => row.slice(cut))
    .join('\n')
    .replace(/^\n+|\s+$/g, '')
}

function parses(text: string): boolean {
  return (ts.transpileModule(text, { reportDiagnostics: true }).diagnostics ?? []).length === 0
}

function merged(comments: Comment[]): Comment[] {
  const blocks: Comment[] = []
  for (const comment of comments) {
    const last = blocks.at(-1)
    if (comment.line && last?.line) last.text = `${last.text}\n${comment.text}`
    else blocks.push({ ...comment })
  }
  return blocks
}

function authored(block: Comment): boolean {
  const text = block.text.trim()
  if (text === '') return false
  return block.doc || (/\s/.test(text) && !parses(text))
}

export function docOf(node: ts.Node, source: ts.SourceFile): string | undefined {
  const comments = adjacent(anchorOf(node), source)
    .map((range) => commentOf(range, source))
    .filter((comment) => comment.doc || !DIRECTIVE.test(comment.text.trimStart()))
  const text = merged(comments)
    .filter(authored)
    .map((block) => dedented(block.text))
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
