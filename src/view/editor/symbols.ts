import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { getStyleTags, tags, type Tag } from '@lezer/highlight'

export type SymbolKind = 'function' | 'method' | 'class' | 'type' | 'variable'

export type Definition = {
  name: string
  kind: SymbolKind
  from: number
  line: number
  imported: boolean
  moduleScope: boolean
}

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode']

const PARSE_BUDGET_MS = 200

const KINDS: [Tag, SymbolKind][] = [
  [tags.function(tags.definition(tags.variableName)), 'function'],
  [tags.function(tags.definition(tags.propertyName)), 'method'],
  [tags.definition(tags.className), 'class'],
  [tags.definition(tags.typeName), 'type'],
  [tags.definition(tags.propertyName), 'method'],
  [tags.definition(tags.variableName), 'variable'],
]

function kindOf(node: SyntaxNode): SymbolKind | null {
  const styled = getStyleTags(node)?.tags ?? []
  const found = KINDS.find(([tag]) => styled.some((t) => t.set.includes(tag)))
  if (!found) return null
  if (found[1] === 'method' && !node.parent?.getChild('ParamList')) return null
  return found[1]
}

function within(node: SyntaxNode, name: string): boolean {
  for (let at = node.parent; at; at = at.parent) if (at.name === name) return true
  return false
}

export function definitionsIn(state: EditorState): Definition[] {
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state)
  const found: Definition[] = []
  tree.iterate({
    enter(ref) {
      const kind = kindOf(ref.node)
      if (!kind) return
      const scope = ref.node.parent?.parent
      found.push({
        name: state.sliceDoc(ref.from, ref.to),
        kind,
        from: ref.from,
        line: state.doc.lineAt(ref.from).number,
        imported: within(ref.node, 'ImportDeclaration'),
        moduleScope: !scope?.parent || !scope.parent.parent,
      })
    },
  })
  return found
}

export function outlineOf(definitions: Definition[]): Definition[] {
  return definitions.filter((d) => !d.imported && (d.kind !== 'variable' || d.moduleScope))
}

export function wordAt(state: EditorState, pos: number): { name: string; from: number } | null {
  const range = state.wordAt(pos)
  return range && { name: state.sliceDoc(range.from, range.to), from: range.from }
}

export function definitionOf(definitions: Definition[], name: string, pos: number): Definition | null {
  const named = definitions.filter((d) => d.name === name)
  return named.filter((d) => d.from <= pos).at(-1) ?? named[0] ?? null
}
