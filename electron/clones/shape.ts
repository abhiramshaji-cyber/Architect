import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { CodeMap } from '../../shared/types'
import { declaredName, ownerFor } from '../scan/names'
import { SCRIPT_KINDS, valueOf } from '../scan/scan'

export type Shape = { tokens: number[]; words: Set<number> }

const words = new Map<string, number>()

const cache = new Map<string, { hash: string; shapes: Map<string, Shape> }>()

function word(text: string): number {
  let at = words.get(text)
  if (at === undefined) {
    at = words.size
    words.set(text, at)
  }
  return at
}

function boundIn(fn: ts.Node): Set<string> {
  const names = new Set<string>()
  const visit = (node: ts.Node) => {
    if ((ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isBindingElement(node)) && ts.isIdentifier(node.name)) names.add(node.name.text)
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node !== fn && node.name) names.add(node.name.text)
    ts.forEachChild(node, visit)
  }
  visit(fn)
  return names
}

function isPropertyName(node: ts.Identifier | ts.PrivateIdentifier): boolean {
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node
  if (ts.isQualifiedName(parent)) return parent.right === node
  if (ts.isBindingElement(parent)) return parent.propertyName === node
  if (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent)) return parent.name === node
  return ts.isJsxAttribute(parent)
}

const SKIPPED = new Set([ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.DefaultKeyword, ts.SyntaxKind.DeclareKeyword])

function shapeOf(fn: ts.Node): Shape {
  const bound = boundIn(fn)
  const order = new Map<string, number>()
  const own = ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) ? fn.name : undefined
  const out: number[] = []
  const outside = new Set<number>()
  const used = (text: string) => {
    const at = word(text)
    outside.add(at)
    out.push(at)
  }
  const visit = (node: ts.Node): void => {
    if (node === own || SKIPPED.has(node.kind) || ts.isTypeNode(node) || ts.isTypeParameterDeclaration(node)) return
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      if (isPropertyName(node) || !bound.has(node.text)) return used(node.text)
      if (!order.has(node.text)) order.set(node.text, order.size)
      return void out.push(word(`$${order.get(node.text)}`))
    }
    if (ts.isLiteralExpression(node) || ts.isTemplateLiteralToken(node)) return used(`#${node.text}`)
    if (node.kind === ts.SyntaxKind.EqualsGreaterThanToken) return
    if (ts.isParenthesizedExpression(node)) return visit(node.expression)
    if (node !== fn) out.push(word(`k${node.kind}`))
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
      node.modifiers?.forEach(visit)
      node.parameters.forEach(visit)
      out.push(word(`k${ts.SyntaxKind.Block}`), word(`k${ts.SyntaxKind.ReturnStatement}`))
      return visit(node.body)
    }
    ts.forEachChild(node, visit)
  }
  visit(fn)
  return { tokens: out, words: outside }
}

function shapesIn(source: string, file: string): Map<string, Shape> {
  const kind = SCRIPT_KINDS.get(path.extname(file).toLowerCase())
  const shapes = new Map<string, Shape>()
  if (kind === undefined) return shapes
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const visit = (node: ts.Node, owner: string): void => {
    const name = declaredName(node, owner)
    if (name !== undefined) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
      shapes.set(`${line}:${name}`, shapeOf(valueOf(node) ?? node))
    }
    const next = ownerFor(node, owner)
    ts.forEachChild(node, (child) => visit(child, next))
  }
  ts.forEachChild(sourceFile, (child) => visit(child, ''))
  return shapes
}

export function shapesOf(root: string, map: CodeMap): Shape[] {
  return map.folders.flatMap((folder) =>
    folder.files.flatMap((file) => {
      if (file.functions.length === 0) return []
      let source = ''
      try {
        source = fs.readFileSync(path.join(root, file.path), 'utf8')
      } catch {
        return file.functions.map((): Shape => ({ tokens: [], words: new Set() }))
      }
      const at = `${root}\0${file.path}`
      const hash = createHash('sha256').update(source).digest('hex')
      const known = cache.get(at)
      const shapes = known?.hash === hash ? known.shapes : shapesIn(source, file.path)
      cache.set(at, { hash, shapes })
      return file.functions.map((fn) => shapes.get(`${fn.line}:${fn.name}`) ?? { tokens: [], words: new Set<number>() })
    }),
  )
}
