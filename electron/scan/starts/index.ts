import ts from 'typescript'
import type { StartKind } from '../../../shared/types'
import { bridgedIn } from './bridge'
import { commandsIn } from './argv'
import { handled, refsIn, type Call, type Code } from './refs'
import { registrationsIn } from './register'

export type { Call } from './refs'

const REGISTERS = ['ipcMain', 'registerTool', 'McpServer', 'CallToolRequestSchema', 'command', 'action']

export type Start = { kind: StartKind; calls: Call[] }

const TEST_FILE = /(^|\/)(__tests__|__mocks__)\/|\.(test|spec)\.[cm]?[jt]sx?$/

export const isTestFile = (file: string): boolean => TEST_FILE.test(file)

export function calleeName(expression: ts.Expression, self: string): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return self === '' ? undefined : self
  if (ts.isParenthesizedExpression(expression)) return calleeName(expression.expression, self)
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    const base = calleeName(expression.expression, self)
    return base === undefined ? undefined : `${base}.${expression.name.text}`
  }
  return undefined
}

export function startsIn(
  source: ts.SourceFile,
  functions: ts.Node[],
  nested: Set<ts.Node>,
  resolveName: (name: string, at: ts.Node) => Call | undefined,
  bindings: ReadonlyMap<string, { spec: string } | null>,
): Start[] {
  if (isTestFile(source.fileName)) return []
  const index = new Map(functions.map((node, at) => [node, at]))
  const code: Code = {
    nested,
    local: (node) => index.get(node),
    resolve: (expression, at) => {
      const name = calleeName(expression, '')
      return name === undefined ? undefined : resolveName(name, at)
    },
  }
  const imports = new Map([...bindings].map(([name, binding]) => [name, binding?.spec ?? '']))
  const byKind = new Map<StartKind, Call[]>()
  const add = (kind: StartKind, calls: Call[]) => {
    const into = byKind.get(kind) ?? []
    for (const call of calls) if (!into.includes(call)) into.push(call)
    byKind.set(kind, into)
  }

  const text = source.text
  add('load', refsIn(source, code))
  if (REGISTERS.some((word) => text.includes(word))) {
    for (const { kind, handler } of registrationsIn(source, functions, code, imports)) add(kind, handled(handler, code))
  }
  if (text.includes('argv')) for (const body of commandsIn(source)) add('cliCommand', refsIn(body, code))
  if (text.includes('exposeIn')) add('bridge', bridgedIn(source, code))

  return [...byKind].flatMap(([kind, calls]) => (calls.length > 0 ? [{ kind, calls }] : []))
}
