import ts from 'typescript'
import type { StartKind } from '../../../shared/types'
import { isInline, unwrapped, type Call, type Code } from './refs'

export type Registration = { kind: StartKind; handler: ts.Node }

type Registrar = { kind: StartKind; at: number | 'handler' }

const LAST = -1

const IPC = new Set(['handle', 'handleOnce', 'on', 'once'])

function nameOf(node: ts.Expression): string | undefined {
  const value = unwrapped(node)
  if (ts.isIdentifier(value)) return value.text
  return ts.isPropertyAccessExpression(value) ? value.name.text : undefined
}

function chainRoot(node: ts.Expression, seen: (call: ts.CallExpression) => void): ts.Expression {
  let at = unwrapped(node)
  while (ts.isCallExpression(at) || ts.isPropertyAccessExpression(at)) {
    if (ts.isCallExpression(at)) seen(at)
    at = unwrapped(at.expression)
  }
  return at
}

function initializerOf(source: ts.SourceFile, name: string): ts.Expression | undefined {
  let hit: ts.Expression | undefined
  const visit = (node: ts.Node): void => {
    if (hit !== undefined) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) hit = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(source)
  return hit
}

function isCommander(node: ts.Expression, source: ts.SourceFile, imports: ReadonlyMap<string, string>, depth = 0): boolean {
  let commands = false
  const root = chainRoot(node, (call) => {
    if (nameOf(call.expression) === 'command') commands = true
  })
  if (commands) return true
  if (ts.isNewExpression(root)) return nameOf(root.expression) === 'Command'
  if (!ts.isIdentifier(root)) return false
  if (imports.get(root.text) === 'commander') return true
  const init = depth < 4 ? initializerOf(source, root.text) : undefined
  return init !== undefined && isCommander(init, source, imports, depth + 1)
}

function builtIn(call: ts.CallExpression, source: ts.SourceFile, imports: ReadonlyMap<string, string>): Registrar | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined
  const method = call.expression.name.text
  const receiver = nameOf(call.expression.expression)
  const first = call.arguments[0]

  if (receiver === 'ipcMain' && IPC.has(method)) return { kind: 'ipcHandler', at: 1 }
  if (method === 'registerTool') return { kind: 'mcpTool', at: LAST }
  if (method === 'tool' && imports.has('McpServer') && first && ts.isStringLiteralLike(first)) {
    return { kind: 'mcpTool', at: LAST }
  }
  if (method === 'setRequestHandler' && first && nameOf(first) === 'CallToolRequestSchema') {
    return { kind: 'mcpTool', at: 1 }
  }
  if (method === 'action' && isCommander(call.expression.expression, source, imports)) {
    return { kind: 'cliCommand', at: LAST }
  }
  if (method === 'command' && call.arguments.length >= 4) return { kind: 'cliCommand', at: LAST }
  if (method === 'command' && first && ts.isObjectLiteralExpression(unwrapped(first))) {
    return { kind: 'cliCommand', at: 'handler' }
  }
  return undefined
}

function propertyOf(node: ts.Expression | undefined, name: string): ts.Node | undefined {
  const value = node && unwrapped(node)
  if (!value || !ts.isObjectLiteralExpression(value)) return undefined
  const hit = value.properties.find((p) => p.name !== undefined && ts.isIdentifier(p.name) && p.name.text === name)
  if (hit === undefined) return undefined
  if (ts.isShorthandPropertyAssignment(hit)) return hit.name
  return ts.isPropertyAssignment(hit) && !holdsFunction(hit) ? hit.initializer : hit
}

function holdsFunction(node: ts.PropertyAssignment): boolean {
  const value = unwrapped(node.initializer)
  return ts.isArrowFunction(value) || ts.isFunctionExpression(value)
}

function handlerOf(call: ts.CallExpression, registrar: Registrar): ts.Node | undefined {
  if (registrar.at === 'handler') return propertyOf(call.arguments[0], 'handler')
  const at = registrar.at === LAST ? call.arguments.length - 1 : registrar.at
  return call.arguments[at]
}

function paramAt(fn: ts.Node, handler: ts.Node): number {
  if (!ts.isFunctionLike(fn) || !ts.isExpression(handler)) return -1
  const names = fn.parameters.map((param) => (ts.isIdentifier(param.name) ? param.name.text : ''))
  const value = unwrapped(handler)
  if (ts.isIdentifier(value)) return names.indexOf(value.text)
  if (!isInline(value)) return -1

  let hit = -1
  const visit = (node: ts.Node): void => {
    if (hit !== -1) return
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) hit = names.indexOf(node.expression.text)
    ts.forEachChild(node, visit)
  }
  visit(value.body)
  return hit
}

function callsOf(root: ts.Node): ts.CallExpression[] {
  const calls: ts.CallExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) calls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return calls
}

function wrapperBody(fn: ts.Node): ts.Node | undefined {
  if (ts.isFunctionLike(fn)) return fn
  if (ts.isVariableDeclaration(fn) || ts.isPropertyAssignment(fn) || ts.isPropertyDeclaration(fn)) {
    const value = fn.initializer && unwrapped(fn.initializer)
    return value && isInline(value) ? value : undefined
  }
  return undefined
}

export function registrationsIn(
  source: ts.SourceFile,
  functions: ts.Node[],
  code: Code,
  imports: ReadonlyMap<string, string>,
): Registration[] {
  const calls = callsOf(source)
  const wrappers = new Map<Call, Registrar>()
  const owner = new Map<Call, ts.Node>()
  for (const fn of functions) {
    const body = wrapperBody(fn)
    const self = code.local(fn)
    if (body && self !== undefined) owner.set(self, body)
  }

  const registrarOf = (call: ts.CallExpression): Registrar | undefined => {
    const hit = code.resolve(call.expression, call)
    return builtIn(call, source, imports) ?? (hit === undefined ? undefined : wrappers.get(hit))
  }

  // wrappers
  for (let grew = true; grew; ) {
    grew = false
    for (const [self, body] of owner) {
      if (wrappers.has(self)) continue
      for (const call of callsOf(body)) {
        const registrar = registrarOf(call)
        const handler = registrar && handlerOf(call, registrar)
        const at = handler ? paramAt(body, handler) : -1
        if (!registrar || at === -1) continue
        wrappers.set(self, { kind: registrar.kind, at })
        grew = true
        break
      }
    }
  }

  return calls.flatMap((call) => {
    const registrar = registrarOf(call)
    const handler = registrar && handlerOf(call, registrar)
    return registrar && handler ? [{ kind: registrar.kind, handler }] : []
  })
}
