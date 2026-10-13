import { HighlightStyle, LanguageSupport, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { highlightCode, tags } from '@lezer/highlight'

const script = (dialect: { typescript?: boolean; jsx?: boolean }) => () =>
  import('@codemirror/lang-javascript').then((m) => m.javascript(dialect))

const GRAMMARS: Record<string, () => Promise<Extension>> = {
  ts: script({ typescript: true }),
  mts: script({ typescript: true }),
  cts: script({ typescript: true }),
  tsx: script({ typescript: true, jsx: true }),
  js: script({}),
  mjs: script({}),
  cjs: script({}),
  jsx: script({ jsx: true }),
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  jsonc: () => import('@codemirror/lang-json').then((m) => m.json()),
  md: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  markdown: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  htm: () => import('@codemirror/lang-html').then((m) => m.html()),
  py: () => import('@codemirror/lang-python').then((m) => m.python()),
  pyi: () => import('@codemirror/lang-python').then((m) => m.python()),
}

const loaded = new Map<string, Promise<Extension | null>>()

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export type Span = { text: string; classes: string }

export const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.operatorKeyword, tags.self], color: 'var(--syn-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.character], color: 'var(--syn-string)' },
  { tag: [tags.regexp, tags.escape], color: 'var(--syn-regexp)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.unit], color: 'var(--syn-number)' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.standard(tags.typeName)], color: 'var(--syn-type)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.function(tags.definition(tags.variableName)), tags.macroName], color: 'var(--syn-fn)' },
  { tag: [tags.propertyName, tags.definition(tags.propertyName), tags.attributeName], color: 'var(--syn-prop)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--syn-tag)' },
  { tag: [tags.constant(tags.variableName), tags.standard(tags.variableName), tags.labelName], color: 'var(--syn-number)' },
  { tag: [tags.operator, tags.punctuation, tags.bracket, tags.separator], color: 'var(--syn-punct)' },
  { tag: [tags.meta, tags.processingInstruction, tags.documentMeta], color: 'var(--syn-comment)' },
  { tag: tags.heading, color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--syn-string)', textDecoration: 'underline' },
  { tag: [tags.monospace, tags.quote], color: 'var(--syn-string)' },
  { tag: tags.invalid, color: 'var(--danger)' },
])

export const highlighting: Extension = syntaxHighlighting(highlightStyle)

export function highlightLines(lines: string[], language: Extension | null): Span[][] {
  if (!(language instanceof LanguageSupport)) return lines.map((text) => [{ text, classes: '' }])

  const code = lines.join('\n')
  let row: Span[] = []
  const out = [row]
  highlightCode(
    code,
    language.language.parser.parse(code),
    highlightStyle,
    (text, classes) => row.push({ text, classes }),
    () => out.push((row = []))
  )
  return out
}

export function languageFor(path: string): Promise<Extension | null> {
  const extension = extensionOf(path)
  const grammar = Object.hasOwn(GRAMMARS, extension) ? GRAMMARS[extension] : undefined
  if (!grammar) return Promise.resolve(null)

  const already = loaded.get(extension)
  if (already) return already

  const loading = grammar().catch((failure: unknown) => {
    console.error(`architect: the ${extension} grammar failed to load, showing plain text`, failure)
    loaded.delete(extension)
    return null
  })
  loaded.set(extension, loading)
  return loading
}
