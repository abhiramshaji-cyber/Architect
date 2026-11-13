import ts from 'typescript'
import type { StartKind } from '../../../shared/types'
import { bridgedIn } from './bridge'
import { commandsIn } from './argv'
import { handled, handlerSites, lineOf, refsIn, type Call, type Code, type Site } from './refs'
import { registrationsIn } from './register'

export type { Call, Site } from './refs'
export { lineOf } from './refs'

const REGISTERS = ['ipcMain', 'registerTool', 'McpServer', 'CallToolRequestSchema', 'command', 'action']

export type Start = { kind: StartKind; calls: Call[]; channel?: string; member?: string; line?: number; sites?: Site[] }

const TEST_FILE = /(^|\/)(__tests__|__mocks__)\/|\.(test|spec)\.[cm]?[jt]sx?$/

export const isTestFile = (file: string): boolean => TEST_FILE.test(file)

export function calleeName(expression: ts.Expression, self: string): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return self === '' ? undefined : self
  if (ts.isParenthesizedExpression(expression)) return calleeName(expression.expression, self)
  const member = memberOf(expression)
  if (member === undefined) return undefined
  const base = calleeName(member.object, self)
  return base === undefined ? undefined : `${base}.${member.name}`
}

function memberOf(expression: ts.Expression): { object: ts.Expression; name: string } | undefined {
  if (ts.isPropertyAccessExpression(expression)) return { object: expression.expression, name: expression.name.text }
  if (!ts.isElementAccessExpression(expression)) return undefined
  const key = expression.argumentExpression
  return ts.isStringLiteralLike(key) || ts.isNumericLiteral(key) ? { object: expression.expression, name: key.text } : undefined
}

export function startsIn(
  source: ts.SourceFile,
  functions: ts.Node[],
  nested: Set<ts.Node>,
  resolveName: (name: string, at: ts.Node) => Call | undefined,
  bindings: ReadonlyMap<string, { spec: string } | null>,
  sites: (node: ts.Node) => Site[],
): Start[] {
  if (isTestFile(source.fileName)) return []
  const index = new Map(functions.map((node, at) => [node, at]))
  const code: Code = {
    nested,
    local: (node) => index.get(node),
    sites,
    resolve: (expression, at) => {
      const name = calleeName(expression, '')
      return name === undefined ? undefined : resolveName(name, at)
    },
  }
  const imports = new Map([...bindings].map(([name, binding]) => [name, binding?.spec ?? '']))
  const byKind = new Map<string, Start>()
  const add = (kind: StartKind, calls: Call[], extra: Omit<Start, 'kind' | 'calls'> = {}) => {
    const key = `${kind}\0${extra.member ?? ''}\0${extra.channel ?? ''}`
    const into = byKind.get(key) ?? { kind, calls: [], ...extra }
    for (const call of calls) if (!into.calls.includes(call)) into.calls.push(call)
    byKind.set(key, into)
  }

  const text = source.text
  add('load', refsIn(source, code))
  if (REGISTERS.some((word) => text.includes(word))) {
    for (const { kind, handler, call, channel } of registrationsIn(source, functions, code, imports)) {
      const routed = channel === undefined ? {} : { channel, line: lineOf(call), sites: handlerSites(handler, code, call) }
      add(kind, handled(handler, code), routed)
    }
  }
  if (text.includes('argv')) for (const body of commandsIn(source)) add('cliCommand', refsIn(body, code))
  if (text.includes('exposeIn')) for (const { calls, ...member } of bridgedIn(source, code, functions)) add('bridge', calls, member)

  return [...byKind.values()].filter((start) => start.calls.length > 0 || start.channel !== undefined)
}
