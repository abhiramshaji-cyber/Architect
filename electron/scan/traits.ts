import ts from 'typescript'
import type { FunctionKind } from '../../shared/types'

const MAX_WORDS = 20

const DIRECTIVE = /^(eslint|oxlint|prettier|istanbul|c8|biome|tslint|jshint|@ts-|#|copyright|license|spdx)\b/i

const CODE = /[{};]|=>/

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

function prose(raw: string): string {
  const lines = raw
    .replace(/^\/\*+|\*+\/$/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*(\/\/+|\*+)?\s?/, '').trim())
  const tags = lines.findIndex((line) => line.startsWith('@'))
  return (tags === -1 ? lines : lines.slice(0, tags))
    .join(' ')
    .replace(/\{@\w+\s+([^}|]+?)(?:\s*\|[^}]*)?\}/g, '$1')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstSentence(text: string): string {
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(text)?.[1] ?? text
  const words = sentence.split(' ')
  const kept = words.length > MAX_WORDS ? `${words.slice(0, MAX_WORDS).join(' ')}…` : sentence
  const capital = kept.charAt(0).toUpperCase() + kept.slice(1)
  return /[.!?…]$/.test(capital) ? capital : `${capital}.`
}

export function docOf(node: ts.Node, source: ts.SourceFile): string | undefined {
  const text = adjacent(anchorOf(node), source)
    .map((range) => prose(source.text.slice(range.pos, range.end)))
    .join(' ')
    .trim()
  if (text.split(' ').length < 2 || DIRECTIVE.test(text) || CODE.test(text)) return undefined
  return firstSentence(text)
}

function drawsJsx(node: ts.Node, nested: Set<ts.Node>): boolean {
  const visit = (child: ts.Node): boolean => {
    if (nested.has(child)) return false
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) return true
    return ts.forEachChild(child, visit) ?? false
  }
  return ts.forEachChild(node, visit) ?? false
}

export function kindOf(node: ts.Node, nested: Set<ts.Node>): FunctionKind | undefined {
  if (ts.isConstructorDeclaration(node)) return 'constructor'
  if (ts.isGetAccessorDeclaration(node)) return 'getter'
  if (ts.isSetAccessorDeclaration(node)) return 'setter'
  if (drawsJsx(node, nested)) return 'component'
  return ts.isClassLike(node.parent) ? 'method' : undefined
}

export function renderedTag(node: ts.Node): ts.Expression | undefined {
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return undefined
  const tag = node.tagName
  if (ts.isIdentifier(tag)) return /^[a-z]|-/.test(tag.text) ? undefined : tag
  return ts.isPropertyAccessExpression(tag) ? tag : undefined
}
