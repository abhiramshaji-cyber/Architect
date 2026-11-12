import type { FunctionSplit, RuleEntry } from '../../../shared/types'
import { lastFor } from '../audit'
import { parsed, type SourceFacts } from '../facts'
import { pointsOf } from './points'

function callersOf(considered: SourceFacts[]): Map<string, number> {
  const callers = new Map<string, Set<string>>()
  for (const file of considered) {
    file.functions.forEach((fn, at) => {
      const self = `${file.path}\0${at}`
      for (const call of fn.calls) {
        const target = `${call.file}\0${call.fn}`
        if (target !== self) callers.set(target, (callers.get(target) ?? new Set()).add(self))
      }
    })
  }
  return new Map([...callers].map(([target, from]) => [target, from.size]))
}

export function functionSplits(entries: RuleEntry[], considered: SourceFacts[], read: (file: string) => string | undefined): FunctionSplit[] {
  const callers = callersOf(considered)
  return considered.flatMap((file) => {
    const threshold = lastFor(entries, 'split', file.path)?.threshold ?? 'off'
    if (threshold === 'off') return []

    const big = file.functions.flatMap((fn, at) => {
      const lines = fn.endLine - fn.line + 1
      const count = callers.get(`${file.path}\0${at}`) ?? 0
      return lines > threshold.lines && count >= threshold.callers ? [{ fn, lines, count }] : []
    })
    if (big.length === 0) return []

    const text = read(file.path)
    const source = text === undefined ? undefined : parsed(text, file.path)
    return big.map(({ fn, lines, count }) => {
      const points = pointsOf(source, fn, file.functions)
      const found = typeof points === 'string' ? { points: [], blocked: points } : { points }
      return { kind: 'function' as const, path: file.path, name: fn.name, line: fn.line, endLine: fn.endLine, lines, callers: count, threshold, ...found }
    })
  })
}
