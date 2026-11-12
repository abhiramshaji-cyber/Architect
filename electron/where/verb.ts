import { folderOf } from '../rules/audit'
import type { Fn } from './refs'

export type Verb = {
  status: 'found' | 'tied' | 'none'
  verb: string | null
  reason: string
  counts: { word: string; count: number; evidence: string[] }[]
  proposed: { name: string; word: string | null; count: number } | null
}

export function leadingWord(name: string): string | null {
  const last = name.split('.').pop() ?? name
  const word = last.split(/[^A-Za-z0-9]+/).flatMap((part) => part.match(/[A-Z]+(?![a-z])\d*|[A-Z]?[a-z]+\d*|\d+/g) ?? [])[0]
  return word === undefined ? null : word.toLowerCase()
}

const authored = (fn: Fn) => !fn.test && fn.name !== 'default' && !fn.name.endsWith('.constructor')

export function verbOf(fns: Fn[], folder: string | null, proposed?: string): Verb {
  const inFolder = folder === null ? [] : fns.filter((fn) => authored(fn) && (folderOf(fn.file) || '.') === folder)
  const words = new Map<string, string[]>()
  for (const fn of inFolder) {
    const word = leadingWord(fn.name)
    if (word !== null) words.set(word, [...(words.get(word) ?? []), `${fn.file}:${fn.line} ${fn.name}`])
  }
  const counts = [...words].map(([word, evidence]) => ({ word, count: evidence.length, evidence })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
  const best = counts[0]
  const tied = counts.filter((entry) => entry.count === best?.count)
  const status = !best ? 'none' : tied.length > 1 ? 'tied' : 'found'
  const verb = status === 'found' && best ? best.word : null

  const reason =
    folder === null ? 'no folder is picked, so there are no neighbours to read names from'
    : !best ? `no named functions in ${folder}`
    : tied.length > 1 ? `${tied.map((entry) => entry.word).join(', ')} each lead ${best.count} of ${inFolder.length} function names in ${folder}`
    : `${best.word} leads ${best.count} of ${inFolder.length} function names in ${folder}`

  const word = proposed === undefined ? null : leadingWord(proposed)
  return {
    status,
    verb,
    reason,
    counts,
    proposed: proposed === undefined ? null : { name: proposed, word, count: counts.find((entry) => entry.word === word)?.count ?? 0 },
  }
}
