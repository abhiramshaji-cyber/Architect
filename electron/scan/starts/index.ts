import ts from 'typescript'
import { isTestFile } from '../../../shared/tests'
import type { CallRef, FileStart, StartKind } from '../../../shared/types'
import { bridgedIn } from './bridge'
import { commandsIn } from './argv'
import { handled, refsIn, type Code } from './refs'
import { registrationsIn } from './register'

export type { Code } from './refs'

const REGISTERS = ['ipcMain', 'registerTool', 'McpServer', 'CallToolRequestSchema', 'command', 'action']

export type Start<T> = { kind: StartKind; calls: T[] }

export function startsIn<T>(
  source: ts.SourceFile,
  functions: ts.Node[],
  code: Code<T>,
  imports: ReadonlyMap<string, string>,
): Start<T>[] {
  if (isTestFile(source.fileName)) return []
  const byKind = new Map<StartKind, T[]>()
  const add = (kind: StartKind, calls: T[]) => {
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

type Linked = { functions: { exported?: true }[]; starts: FileStart[]; stars: string[] }

export function starred(parsed: Map<string, Linked>, target: (file: string, spec: string) => string | undefined): void {
  const api = (file: string, seen: Set<string>): CallRef[] => {
    const at = parsed.get(file)
    if (at === undefined || seen.has(file)) return []
    seen.add(file)
    const own = at.functions.flatMap((fn, i) => (fn.exported === true ? [{ file, fn: i }] : []))
    const named = at.starts.find((start) => start.kind === 'exports')?.calls ?? []
    const deeper = at.stars.flatMap((spec) => {
      const to = target(file, spec)
      return to === undefined ? [] : api(to, seen)
    })
    return [...own, ...named, ...deeper]
  }

  for (const [file, at] of parsed) {
    const into = at.starts.find((start) => start.kind === 'exports')
    if (into === undefined) continue
    for (const ref of api(file, new Set()).filter((ref) => ref.file !== file)) {
      if (!into.calls.some((c) => c.file === ref.file && c.fn === ref.fn)) into.calls.push(ref)
    }
  }
}
