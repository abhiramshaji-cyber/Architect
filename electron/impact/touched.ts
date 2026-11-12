import { functionsIn } from '../scan/scan'

export type Change = { name: string; key: string; line: number; change: 'added' | 'changed' | 'removed'; shares: string[] }

type Span = { name: string; line: number; endLine: number }

type Body = { name: string; key: string; line: number; endLine: number; text: string }

const ORDER: Change['change'][] = ['changed', 'removed', 'added']

const holds = (outer: Span, inner: Span) => outer.endLine > inner.endLine || (outer.endLine === inner.endLine && outer.line < inner.line && inner.line < outer.endLine)

export function keysOf(fns: Span[]): string[] {
  const open: (Span & { key: string })[] = []
  const seen = new Map<string, number>()
  return fns.map((fn) => {
    while (open.length > 0 && !holds(open.at(-1) as Span, fn)) open.pop()
    const base = `${open.at(-1)?.key ?? ''}/${fn.name}`
    const nth = seen.get(base) ?? 0
    seen.set(base, nth + 1)
    const key = `${base}#${nth}`
    open.push({ ...fn, key })
    return key
  })
}

function bodies(source: string, file: string): Map<string, Body> {
  const lines = source.split(/\r?\n/)
  const fns = functionsIn(source, file)
  const keys = keysOf(fns)
  return new Map(
    fns.map((fn, i) => {
      const key = keys[i] ?? ''
      const inner = fns.filter((_, j) => (keys[j] ?? '').startsWith(`${key}/`))
      const own = (line: number) => line === fn.line || line === fn.endLine || !inner.some((child) => child.line <= line && line <= child.endLine)
      const text = lines.slice(fn.line - 1, fn.endLine).filter((_, at) => own(fn.line + at)).join('\n')
      return [key, { name: fn.name, key, line: fn.line, endLine: fn.endLine, text }]
    }),
  )
}

function sharing(all: Map<string, Body>, body: Body): string[] {
  const related = (other: Body) => other.key.startsWith(`${body.key}/`) || body.key.startsWith(`${other.key}/`)
  return [...all.values()].filter((other) => other !== body && !related(other) && other.line <= body.endLine && body.line <= other.endLine).map((other) => other.name)
}

function outside(source: string, file: string): string {
  const spans = functionsIn(source, file)
  return source.split(/\r?\n/).flatMap((line, at) => (spans.some((fn) => fn.line <= at + 1 && at + 1 <= fn.endLine) || line.trim() === '' ? [] : [line.trim()])).join('\n')
}

export function changesOf(file: string, before: string, after: string): { changes: Change[]; parsed: number; outside: boolean } {
  const old = bodies(before, file)
  const next = bodies(after, file)
  const change = (all: Map<string, Body>, body: Body, kind: Change['change']): Change => ({ name: body.name, key: body.key, line: body.line, change: kind, shares: sharing(all, body) })

  const edited = [...next.values()].flatMap((body): Change[] => {
    const was = old.get(body.key)
    if (!was) return [change(next, body, 'added')]
    return was.text === body.text ? [] : [change(old, was, 'changed')]
  })
  const removed = [...old.values()].flatMap((body): Change[] => (next.has(body.key) ? [] : [change(old, body, 'removed')]))

  const order = (entry: Change) => ORDER.indexOf(entry.change)
  return { changes: [...edited, ...removed].sort((a, b) => order(a) - order(b) || a.line - b.line || a.name.localeCompare(b.name)), parsed: old.size + next.size, outside: outside(before, file) !== outside(after, file) }
}
