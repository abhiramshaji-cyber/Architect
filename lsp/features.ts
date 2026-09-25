import {
  CompletionItemKind,
  DiagnosticSeverity,
  type CompletionItem,
  type Diagnostic,
  type Position,
  type Range,
  type TextEdit,
} from 'vscode-languageserver'

import { scan, sectionAt, type Ref } from '../electron/contract/graph'

function span(ref: Ref): Range {
  return { start: { line: ref.line, character: ref.col }, end: { line: ref.line, character: ref.col + ref.id.length } }
}

function refAt(refs: Ref[], position: Position): Ref | undefined {
  return refs.find(
    (r) => r.line === position.line && position.character >= r.col && position.character <= r.col + r.id.length,
  )
}

export function diagnostics(markdown: string): Diagnostic[] {
  return scan(markdown).problems.map((p) => ({
    severity: DiagnosticSeverity.Error,
    range: { start: { line: p.line, character: p.col }, end: { line: p.line, character: p.end } },
    message: p.message,
    source: 'architect',
  }))
}

export function completions(markdown: string, position: Position): CompletionItem[] {
  const section = sectionAt(markdown, position.line)
  if (section !== 'Dependencies' && section !== 'Forbidden') return []

  // reason
  const line = markdown.split(/\r?\n/)[position.line] ?? ''
  const colon = line.indexOf(':')
  if (colon !== -1 && position.character > colon) return []

  return scan(markdown).architecture.components.map((c) => ({
    label: c.id,
    kind: CompletionItemKind.Class,
    detail: c.purpose,
  }))
}

export function definition(markdown: string, position: Position): Range | undefined {
  const { refs } = scan(markdown)
  const ref = refAt(refs, position)
  if (!ref) return undefined

  const target = refs.find((r) => r.definition && r.id === ref.id)
  return target && span(target)
}

export function renameTarget(markdown: string, position: Position): { range: Range; placeholder: string } | undefined {
  const { refs } = scan(markdown)
  const ref = refAt(refs, position)
  if (!ref || !refs.some((r) => r.definition && r.id === ref.id)) return undefined

  return { range: span(ref), placeholder: ref.id }
}

export function rename(
  markdown: string,
  position: Position,
  newName: string,
): { edits: TextEdit[] } | { error: string } {
  const { architecture, refs } = scan(markdown)

  const ref = refAt(refs, position)
  if (!ref || !refs.some((r) => r.definition && r.id === ref.id)) return { error: 'not a component' }

  // validate
  const id = newName.trim()
  if (id.length === 0) return { error: 'component id cannot be empty' }
  if (/\s/.test(id) || id.includes('->')) {
    return { error: `invalid component id "${id}": ids must be one word with no spaces and no "->"` }
  }
  if (id !== ref.id && architecture.components.some((c) => c.id === id)) return { error: `duplicate component: ${id}` }

  return { edits: refs.filter((r) => r.id === ref.id).map((r) => ({ range: span(r), newText: id })) }
}
