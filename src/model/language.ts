import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { tags } from '@lezer/highlight'

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
}

const loaded = new Map<string, Promise<Extension | null>>()

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export const highlighting: Extension = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier, tags.controlKeyword], color: 'var(--syn-keyword)' },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--syn-string)' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--syn-number)' },
    { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], color: 'var(--syn-type)' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--fn)' },
    { tag: [tags.propertyName, tags.attributeName, tags.definition(tags.variableName)], color: 'var(--syn-name)' },
    { tag: [tags.operator, tags.punctuation, tags.bracket], color: 'var(--syn-punct)' },
    { tag: [tags.heading, tags.strong], color: 'var(--syn-keyword)', fontWeight: '600' },
    { tag: [tags.link, tags.url], color: 'var(--accent)', textDecoration: 'underline' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.invalid, color: 'var(--danger)' },
  ])
)

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
