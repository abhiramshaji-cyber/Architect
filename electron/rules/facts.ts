import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import type { CodeMap, FunctionEntry } from '../../shared/types'

type Named = { name: string; line: number }

export type SourceFacts = { path: string; lines: number; functions: FunctionEntry[]; classes: Named[] }

const CODE = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.swift', '.rb', '.php', '.cs', '.scala',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.vue', '.svelte',
])

const PARSED = new Map([
  ['.ts', ts.ScriptKind.TS],
  ['.mts', ts.ScriptKind.TS],
  ['.cts', ts.ScriptKind.TS],
  ['.tsx', ts.ScriptKind.TSX],
  ['.js', ts.ScriptKind.JSX],
  ['.jsx', ts.ScriptKind.JSX],
  ['.mjs', ts.ScriptKind.JSX],
  ['.cjs', ts.ScriptKind.JSX],
])

const DECLARATION = /\.d\.[mc]?ts$/i

function isCode(file: string): boolean {
  return CODE.has(path.extname(file).toLowerCase()) && !DECLARATION.test(file)
}

function lineCount(text: string): number {
  if (text === '') return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

export function parsed(text: string, file: string): ts.SourceFile | undefined {
  const kind = PARSED.get(path.extname(file).toLowerCase())
  if (kind === undefined || DECLARATION.test(file)) return undefined
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
}

function classesIn(text: string, file: string): Named[] {
  const source = parsed(text, file)
  if (!source) return []

  const found: Named[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isClassLike(node) && node.name) {
      found.push({ name: node.name.text, line: source.getLineAndCharacterOfPosition(node.name.getStart(source)).line + 1 })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

type Classes = (text: string, file: string) => Named[]

export function factsOf(file: string, read: () => string | undefined, functions: (text: string) => FunctionEntry[], classes?: Classes): SourceFacts | null {
  if (!isCode(file)) return null
  const text = read()
  if (text === undefined) return null
  return { path: file, lines: lineCount(text), functions: functions(text), classes: classes ? classes(text, file) : classesIn(text, file) }
}

export function sourcesIn(root: string, map: CodeMap, classes?: Classes): SourceFacts[] {
  const read = (file: string) => () => {
    try {
      return fs.readFileSync(path.join(root, file), 'utf8')
    } catch {
      return undefined
    }
  }
  return map.folders.flatMap((folder) => folder.files.flatMap((file) => factsOf(file.path, read(file.path), () => file.functions, classes) ?? []))
}
