import path from 'node:path'
import type { BehaviorMatch, SameBehavior } from '../../../shared/jev/types'
import type { Architecture, CodeMap } from '../../../shared/types'
import { edgesOf } from '../../functions/facts'
import type { Resolved } from '../../where/refs'
import { similarOf } from '../../where/similar'
import type { Entry, Store } from '../classify/cache'
import { questionsOf, type QuestionSet } from '../classify/questions'
import { vectorOf, type Ask } from '../classify/run'
import { targetsOf, type Target } from '../classify/targets'
import { confirmAll } from './confirm'
import { standoutsOf } from './similarity'

// cost guard: pairwise confirmations sent for one question, strongest first
export const CONFIRM_GUARD = 24

export type Finding = { root: string; map: CodeMap; architecture: Architecture | null; file: string; symbol: string; store: Store; ask: Ask; signal: AbortSignal }

function subjectOf(targets: Target[], root: string, file: string, symbol: string): Target | string {
  const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join('/')
  const inFile = targets.filter((target) => target.file === relative)
  if (inFile.length === 0) return `${relative} has no functions in the scan`
  const found = inFile.find((target) => target.name === symbol) ?? inFile.find((target) => target.name.endsWith(`.${symbol}`))
  return found ?? `${relative} has no function named ${symbol}; it has ${inFile.map((target) => target.name).join(', ')}`
}

function structuralOf(targets: Target[], map: CodeMap, subject: Target): Set<number> {
  const edges = edgesOf(map)
  const resolved = (ats: number[]): Resolved[] => ats.map((i) => ({ ref: targets[i]?.name ?? '', status: 'function', files: [targets[i]?.file ?? ''], fns: [i], matches: [] }))
  const callers = edges.flatMap((out, from) => (out.includes(subject.at) ? [from] : []))
  const fns = targets.map((target) => ({ file: target.file, name: target.name, line: target.line, test: target.test || target.at === subject.at }))
  const similar = similarOf(fns, edges, resolved(edges[subject.at] ?? []), resolved(callers))
  const byPlace = new Map(targets.map((target) => [`${target.file}:${target.line}`, target.at]))
  return new Set(similar.matches.flatMap((match) => byPlace.get(match.at) ?? []))
}

async function entryOf(subject: Target, index: Map<string, Entry>, input: Finding, set: QuestionSet): Promise<Entry> {
  const known = index.get(subject.key)
  if (known) return known
  const reply = await input.ask(subject.state, set.questions, input.signal)
  const entry = { key: subject.key, model: reply.model, at: Date.now(), vector: vectorOf(reply) }
  input.store.addEntry(entry)
  return entry
}

function ioOf(a: Target, b: Target): string {
  const typed = (target: Target) => target.inputs.length > 0 && target.inputs.every((type) => type !== '')
  const inputs = typed(a) && typed(b) ? (a.inputs.join(',') === b.inputs.join(',') ? 'same inputs' : 'different inputs') : 'inputs not fully typed'
  const output = a.output !== '' && b.output !== '' ? (a.output === b.output ? 'same output' : 'different output') : 'output not declared'
  return `${inputs}, ${output}: ${a.name}${a.signature || '()'} vs ${b.name}${b.signature || '()'}`
}

export async function findSame(input: Finding): Promise<SameBehavior> {
  const set = questionsOf(input.architecture)
  const targets = targetsOf(input.root, input.map, set.version)
  const subject = subjectOf(targets, input.root, input.file, input.symbol)
  if (typeof subject === 'string') return { status: 'unknown', reason: subject }

  const index = input.store.entries()
  const others = targets.filter((target) => !target.test && target.at !== subject.at)
  const indexed = others.flatMap((target) => {
    const entry = index.get(target.key)
    return entry ? [{ at: target.at, entry }] : []
  })
  if (indexed.length === 0) return { status: 'unindexed', reason: 'no other function is classified yet; let the Jev index finish first' }
  const entry = await entryOf(subject, index, input, set)

  const structural = structuralOf(targets, input.map, subject)
  const picked = [...structural, ...standoutsOf(entry, indexed).map((item) => item.at).filter((i) => !structural.has(i))]
  const sent = picked.slice(0, CONFIRM_GUARD).flatMap((i) => targets[i] ?? [])
  const { confirmed, failed } = await confirmAll(subject, sent, { store: input.store, ask: input.ask, signal: input.signal, model: entry.model })

  const matches: BehaviorMatch[] = confirmed.flatMap(({ at, probability }) => {
    const other = targets[at]
    return other ? [{ name: other.name, file: other.file, line: other.line, probability, structural: structural.has(at), io: ioOf(subject, other) }] : []
  })
  matches.sort((a, b) => b.probability - a.probability || a.file.localeCompare(b.file) || a.line - b.line)

  const notes = [
    ...(indexed.length < others.length ? [`${indexed.length} of ${others.length} functions are classified so far, so matches among the rest are not searched yet`] : []),
    ...(picked.length > sent.length ? [`${picked.length - sent.length} weaker candidates were not confirmed, to bound the cost of one question at ${CONFIRM_GUARD} pairwise checks`] : []),
    ...(failed > 0 ? [`${failed} confirmations failed and were left out`] : []),
  ]
  return { status: 'done', name: subject.name, file: subject.file, line: subject.line, matches, candidates: sent.length, rejected: sent.length - confirmed.length - failed, notes }
}
