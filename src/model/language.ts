import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { tags } from '@lezer/highlight'

const LANGUAGES: Record<string, () => Extension> = {
  ts: () => javascript({ typescript: true }),
  mts: () => javascript({ typescript: true }),
  cts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  js: () => javascript(),
  mjs: () => javascript(),
  cjs: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  json: () => json(),
  jsonc: () => json(),
  md: () => markdown(),
  markdown: () => markdown(),
  css: () => css(),
}

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

export function languageFor(path: string): Extension | null {
  return LANGUAGES[extensionOf(path)]?.() ?? null
}
