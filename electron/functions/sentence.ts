import path from 'node:path'
import type { FunctionEntry, FunctionFacts } from '../../shared/types'
import { objectOf, verbPhrase, wordsOf } from './verbs'

function usage(fact: FunctionFacts): string {
  if (fact.entry && fact.fanIn === 0) return 'Starting point of the app.'
  if (fact.fanIn === 1) return 'Used in 1 place.'
  return fact.fanIn > 1 ? `Used in ${fact.fanIn.toLocaleString('en-US')} places.` : ''
}

function phrased(entry: FunctionEntry, file: string): string {
  const parts = entry.name.split('.')
  const own = parts.at(-1) ?? entry.name
  const owner = wordsOf(parts.at(-2) ?? '')
  const anonymous = own === 'default'
  const subject = anonymous ? path.basename(file).replace(/\.[^.]*$/, '') : own
  const words = wordsOf(subject)
  const named = words.join(' ')

  if (entry.kind === 'constructor') return owner.length > 0 ? `Sets up a new ${owner.join(' ')}.` : 'Sets up a new one.'
  if (entry.kind === 'getter') return `Gives back ${objectOf(words)}.`
  if (entry.kind === 'setter') return `Changes ${objectOf(words)}.`
  if (entry.kind === 'component' && /^[A-Z]/.test(subject)) return `Draws the ${named} piece on the page.`
  if (anonymous) return `Does the main job of the ${named} file.`

  if (/^use[A-Z0-9]/.test(own)) return `Keeps track of ${objectOf(words.slice(1))}.`
  const event = /^(on|handle)([A-Z0-9].*)$/.exec(own)?.[2]
  if (event !== undefined) return `Runs when ${wordsOf(event).join(' ')} happens.`

  const verb = verbPhrase(words)
  if (verb !== undefined) return verb
  if (entry.kind === 'component') return `Draws ${objectOf(words)} on the page.`
  return words.length > 0 ? `Works out ${objectOf(words)}.` : 'Does a small job.'
}

export function sentenceOf(entry: FunctionEntry, fact: FunctionFacts): string {
  return [entry.doc ?? phrased(entry, fact.file), usage(fact)].filter((part) => part !== '').join(' ')
}
