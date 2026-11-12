import { functionsIn } from '../scan/scan'

export type Change = { name: string; key: string; line: number; change: 'added' | 'changed' | 'removed' }

type Span = { name: string; line: number; endLine: number }

const ORDER: Change['change'][] = ['changed', 'removed', 'added']

export function keysOf(fns: Span[]): string[] {
  const open: { key: string; endLine: number }[] = []
  const seen = new Map<string, number>()
  return fns.map((fn) => {
    while (open.length > 0 && (open.at(-1)?.endLine ?? 0) < fn.endLine) open.pop()
    const base = `${open.at(-1)?.key ?? ''}/${fn.name}`
    const nth = seen.get(base) ?? 0
    seen.set(base, nth + 1)
    const key = `${base}#${nth}`
    open.push({ key, endLine: fn.endLine })
    return key
  })
}

function bodies(source: string, file: string): Map<string, { name: string; key: string; line: number; text: string }> {
  const lines = source.split(/\r?\n/)
  const fns = functionsIn(source, file)
  const keys = keysOf(fns)
  return new Map(fns.map((fn, i) => [keys[i] ?? '', { name: fn.name, key: keys[i] ?? '', line: fn.line, text: lines.slice(fn.line - 1, fn.endLine).join('\n') }]))
}

export function changesOf(file: string, before: string, after: string): { changes: Change[]; parsed: number } {
  const old = bodies(before, file)
  const next = bodies(after, file)

  const edited = [...next.values()].flatMap((body): Change[] => {
    const was = old.get(body.key)
    if (!was) return [{ name: body.name, key: body.key, line: body.line, change: 'added' }]
    return was.text === body.text ? [] : [{ name: was.name, key: was.key, line: was.line, change: 'changed' }]
  })
  const removed = [...old.values()].flatMap((body): Change[] => (next.has(body.key) ? [] : [{ name: body.name, key: body.key, line: body.line, change: 'removed' }]))

  const order = (change: Change) => ORDER.indexOf(change.change)
  return { changes: [...edited, ...removed].sort((a, b) => order(a) - order(b) || a.line - b.line || a.name.localeCompare(b.name)), parsed: old.size + next.size }
}
