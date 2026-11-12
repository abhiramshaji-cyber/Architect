import ts from 'typescript'
import { handled, lineOf, unwrapped, type Call, type Code } from './refs'
import { callsOf, wrapperBody } from './register'

export type Member = {
  calls: Call[]
  member?: string
  channel?: string
  line: number
}

type Walk = {
  source: ts.SourceFile
  code: Code
  seen: Set<ts.Node>
  channel: (node: ts.Node) => string | undefined
}

const EXPOSE = new Set(['exposeInMainWorld', 'exposeInIsolatedWorld'])

const SEND = new Set(['invoke', 'send', 'sendSync'])

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

function textOf(node: ts.Node | undefined): string | undefined {
  const value = node && ts.isExpression(node) ? unwrapped(node) : node
  if (value && (ts.isIdentifier(value) || ts.isStringLiteralLike(value) || ts.isNumericLiteral(value))) return value.text
  return undefined
}

function memberOf(node: ts.Node, calls: Call[], member: string | undefined, walk: Walk): Member {
  const channel = walk.channel(node)
  return {
    calls,
    line: lineOf(node),
    ...(member === undefined ? {} : { member }),
    ...(channel === undefined ? {} : { channel }),
  }
}

function membersOf(api: ts.Node, path: string | undefined, walk: Walk): Member[] {
  const value = ts.isExpression(api) ? unwrapped(api) : api
  const object = ts.isIdentifier(value) ? (objectNamed(walk.source, value.text) ?? value) : value
  if (walk.seen.has(object)) return []
  walk.seen.add(object)
  if (!ts.isObjectLiteralExpression(object)) return [memberOf(object, handled(object, walk.code), path, walk)]

  return object.properties.flatMap((property) => {
    const name = ts.isSpreadAssignment(property) ? undefined : textOf(property.name)
    const at = path === undefined || name === undefined ? undefined : `${path}.${name}`
    if (walk.code.nested.has(property)) return [memberOf(property, handled(property, walk.code), at, walk)]
    if (ts.isShorthandPropertyAssignment(property)) return membersOf(property.name, at, walk)
    if (ts.isSpreadAssignment(property)) return membersOf(property.expression, path, walk)
    return ts.isPropertyAssignment(property) ? membersOf(property.initializer, at, walk) : []
  })
}

function sentAt(call: ts.CallExpression, senders: Map<Call, number>, code: Code): number | undefined {
  const callee = unwrapped(call.expression)
  if (ts.isPropertyAccessExpression(callee) && SEND.has(callee.name.text) && textOf(callee.expression) === 'ipcRenderer') return 0
  const hit = code.resolve(call.expression, call)
  return hit === undefined ? undefined : senders.get(hit)
}

function sendersIn(functions: ts.Node[], code: Code): Map<Call, number> {
  const senders = new Map<Call, number>()
  for (let grew = true; grew;) {
    grew = false
    for (const fn of functions) {
      const self = code.local(fn)
      const body = wrapperBody(fn)
      if (self === undefined || !body || !ts.isFunctionLike(body) || senders.has(self)) continue
      const names = body.parameters.map((param) => (ts.isIdentifier(param.name) ? param.name.text : ''))
      for (const call of callsOf(body)) {
        const at = sentAt(call, senders, code)
        const arg = at === undefined ? undefined : call.arguments[at]
        const value = arg && unwrapped(arg)
        const param = value && ts.isIdentifier(value) ? names.indexOf(value.text) : -1
        if (param === -1) continue
        senders.set(self, param)
        grew = true
        break
      }
    }
  }
  return senders
}

function channelIn(node: ts.Node, senders: Map<Call, number>, code: Code): string | undefined {
  for (const call of callsOf(node)) {
    const at = sentAt(call, senders, code)
    const arg = at === undefined ? undefined : call.arguments[at]
    const value = arg && unwrapped(arg)
    if (value && ts.isStringLiteralLike(value)) return value.text
  }
  return undefined
}

export function bridgedIn(source: ts.SourceFile, code: Code, functions: ts.Node[]): Member[] {
  const senders = sendersIn(functions, code)
  const found: Member[] = []
  const visit = (node: ts.Node): void => {
    const args = ts.isCallExpression(node) ? node.arguments : undefined
    const callee = ts.isCallExpression(node) ? node.expression : undefined
    const api = args?.[args.length - 1]
    if (args && callee && api && ts.isPropertyAccessExpression(callee) && EXPOSE.has(callee.name.text)) {
      const key = args.length > 1 ? unwrapped(args[args.length - 2] as ts.Expression) : undefined
      const name = key && ts.isStringLiteralLike(key) ? key.text : undefined
      const walk: Walk = { source, code, seen: new Set(), channel: (at) => channelIn(at, senders, code) }
      found.push(...membersOf(api, name, walk))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}
