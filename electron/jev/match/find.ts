import path from 'node:path'
import { POSSIBLE, type BehaviorMatch, type JevRun, type SameBehavior } from '../../../shared/jev/types'
import type { Architecture, CodeMap } from '../../../shared/types'
import { ownership } from '../../contract/graph'
import { edgesOf } from '../../functions/facts'
import type { Resolved } from '../../where/refs'
import { similarOf } from '../../where/similar'
import type { Entry, Store } from '../classify/cache'
import { QUESTIONS } from '../classify/questions'
import { vectorOf, type Ask } from '../classify/run'
import { targetsOf, type Target } from '../classify/targets'
import { confirmAll } from './confirm'
import { groupOf, type Member } from './group'
import { standoutsOf } from './similarity'

// cost guard: pairwise confirmations sent for one question, strongest first
export const CONFIRM_GUARD = 24

export type Finding = { root: string; map: CodeMap; architecture: Architecture | null; file: string; symbol: string; store: Store; ask: Ask; signal: AbortSignal; run?: JevRun | null }

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

async function entryOf(subject: Target, index: Map<string, Entry>, input: Finding): Promise<Entry> {
  const known = index.get(subject.key)
  if (known) return known
  const reply = await input.ask(subject.state, QUESTIONS.questions, input.signal)
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

function componentsOf(targets: Target[], architecture: Architecture | null): (file: string) => string | null {
  if (!architecture) return () => null
  const { owned, multi } = ownership([...new Set(targets.map((target) => target.file))], architecture.components)
  const owners = new Map([...owned.map((entry) => [entry.path, entry.owner] as const), ...multi.map((entry) => [entry.path, entry.owners.join(', ')] as const)])
  return (file) => owners.get(file) ?? null
}

function waiting(run: JevRun | null | undefined, others: number): string {
  if (run?.status === 'queued') return `Jev is indexing another open project first; this one is queued and none of its other ${others} functions is classified yet. Ask again in a moment.`
  if (run?.status === 'running') return `Jev is indexing this project: ${run.done} of ${run.total} functions classified so far, none of the other ${others} yet. Ask again in a moment.`
  return `none of the other ${others} functions is classified yet${run?.error ? ` (the last index run stopped: ${run.error})` : ''}; the Jev index starts on its own while Jev is on`
}

const ordered = (a: BehaviorMatch, b: BehaviorMatch) => Number(a.via !== null) - Number(b.via !== null) || b.probability - a.probability || a.file.localeCompare(b.file) || a.line - b.line

export async function findSame(input: Finding): Promise<SameBehavior> {
  const targets = targetsOf(input.root, input.map, QUESTIONS.version)
  const subject = subjectOf(targets, input.root, input.file, input.symbol)
  if (typeof subject === 'string') return { status: 'unknown', reason: subject }

  const index = input.store.entries()
  const others = targets.filter((target) => !target.test && target.at !== subject.at)
  const indexed = others.flatMap((target) => {
    const entry = index.get(target.key)
    return entry ? [{ at: target.at, entry }] : []
  })
  if (indexed.length === 0) return { status: 'unindexed', reason: waiting(input.run, others.length) }
  const entry = await entryOf(subject, index, input)
  const componentOf = componentsOf(targets, input.architecture)

  const structural = structuralOf(targets, input.map, subject)
  const picked = [...structural, ...standoutsOf(entry, indexed).map((item) => item.at).filter((i) => !structural.has(i))].flatMap((i) => targets[i] ?? [])
  const { checked, failed, unchecked } = await confirmAll(subject, picked, { store: input.store, ask: input.ask, signal: input.signal, model: entry.model, guard: CONFIRM_GUARD })

  const live = new Map(others.map((target) => [target.key, target.at]))
  live.set(subject.key, subject.at)
  const { group, possible } = groupOf(subject.at, input.store.pairs().values(), live, entry.model)
  const shown = (member: Member): BehaviorMatch[] => {
    const other = targets[member.at]
    if (!other) return []
    const via = member.via === null ? null : (targets[member.via]?.name ?? null)
    return [{ name: other.name, file: other.file, line: other.line, probability: member.probability, structural: structural.has(member.at), io: ioOf(subject, other), responsibility: componentOf(other.file), via }]
  }

  const notes = [
    ...(indexed.length < others.length ? [`${indexed.length} of ${others.length} functions are classified so far${input.run?.status === 'running' ? ' and indexing is running' : ''}, so matches among the rest are not searched yet`] : []),
    ...(unchecked > 0 ? [`${unchecked} weaker candidates were not confirmed, to bound the cost of one question at ${CONFIRM_GUARD} pairwise checks`] : []),
    ...(failed > 0 ? [`${failed} confirmations failed and were left out`] : []),
  ]
  return {
    status: 'done',
    name: subject.name,
    file: subject.file,
    line: subject.line,
    responsibility: componentOf(subject.file),
    matches: group.flatMap(shown).sort(ordered),
    possible: possible.flatMap(shown).sort(ordered),
    candidates: checked.length,
    rejected: checked.filter((item) => item.probability < POSSIBLE).length,
    notes,
  }
}
