import { functionsIn } from '../scan/scan'

export type Change = { name: string; nth: number; line: number; change: 'added' | 'changed' | 'removed' }

const ORDER: Change['change'][] = ['changed', 'removed', 'added']

type Body = { name: string; nth: number; line: number; text: string }

const keyOf = (body: { name: string; nth: number }) => `${body.name}#${body.nth}`

export function numbered<T extends { name: string }>(fns: T[]): (T & { nth: number })[] {
  const seen = new Map<string, number>()
  return fns.map((fn) => {
    const nth = seen.get(fn.name) ?? 0
    seen.set(fn.name, nth + 1)
    return { ...fn, nth }
  })
}

function bodies(source: string, file: string): Map<string, Body> {
  const lines = source.split('\n')
  return new Map(numbered(functionsIn(source, file)).map((fn) => [keyOf(fn), { name: fn.name, nth: fn.nth, line: fn.line, text: lines.slice(fn.line - 1, fn.endLine).join('\n') }]))
}

export function changesOf(file: string, before: string, after: string): { changes: Change[]; parsed: number } {
  const old = bodies(before, file)
  const next = bodies(after, file)

  const edited = [...next.values()].flatMap((body): Change[] => {
    const was = old.get(keyOf(body))
    if (!was) return [{ name: body.name, nth: body.nth, line: body.line, change: 'added' }]
    return was.text === body.text ? [] : [{ name: was.name, nth: was.nth, line: was.line, change: 'changed' }]
  })
  const removed = [...old.values()].flatMap((body): Change[] => (next.has(keyOf(body)) ? [] : [{ name: body.name, nth: body.nth, line: body.line, change: 'removed' }]))

  const order = (change: Change) => ORDER.indexOf(change.change)
  return { changes: [...edited, ...removed].sort((a, b) => order(a) - order(b) || a.line - b.line || a.name.localeCompare(b.name)), parsed: old.size + next.size }
}
