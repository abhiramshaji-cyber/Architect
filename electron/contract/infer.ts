import type { Architecture, CodeMap } from '../../shared/types'
import { ask } from '../scan/describe'
import { canonical, ownership } from './graph'

const CONFIDENCE = ['certain', 'likely', 'unsure'] as const
const DESCRIPTIONS = 12
const MAX_TOKENS = 400
const TIMEOUT_MS = 30_000

export type Confidence = (typeof CONFIDENCE)[number]

export type Choice = { id: string; purpose: string }

export type Nearby = { component: string; folder: number; calls: number }

export type Question = { path: string; choices: Choice[]; nearby: Nearby[]; does: string[] }

export type Judgement = { component: string; confidence: Confidence; why: string }

export type Attribution = Judgement & { path: string }

export type Judge = (question: Question) => Promise<Judgement | null>

function folderOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}

export function question(path: string, architecture: Architecture, map: CodeMap): Question | null {
  const target = canonical(path)
  if (target === '' || target === '..' || target.startsWith('../')) return null
  if (architecture.components.length === 0) return null

  const files = map.folders.flatMap((folder) => folder.files).map((file) => ({ ...file, path: canonical(file.path) }))

  // owners
  const { owned, multi } = ownership([...files.map((file) => file.path), target], architecture.components)
  const owners = new Map<string, string[]>()
  for (const entry of owned) owners.set(entry.path, [entry.owner])
  for (const entry of multi) owners.set(entry.path, entry.owners)
  if (owners.has(target)) return null

  // count
  const folder = folderOf(target)
  const tally = new Map<string, Nearby>()
  const bump = (id: string, key: 'folder' | 'calls') => {
    const found = tally.get(id) ?? { component: id, folder: 0, calls: 0 }
    found[key] += 1
    tally.set(id, found)
  }

  const self = files.find((file) => file.path === target)
  const out = new Set((self?.functions ?? []).flatMap((fn) => fn.calls.map((call) => canonical(call.file))))

  for (const file of files) {
    if (file.path === target) continue
    const claimed = owners.get(file.path)
    if (!claimed) continue

    const into = file.functions.some((fn) => fn.calls.some((call) => canonical(call.file) === target))
    for (const id of claimed) {
      if (folderOf(file.path) === folder) bump(id, 'folder')
      if (out.has(file.path) || into) bump(id, 'calls')
    }
  }

  const nearby = [...tally.values()].sort(
    (a, b) => b.folder + b.calls - (a.folder + a.calls) || a.component.localeCompare(b.component),
  )

  const does = (self?.functions ?? [])
    .map((fn) => (fn.description ? `${fn.name}: ${fn.description}` : fn.name))
    .slice(0, DESCRIPTIONS)

  return {
    path: target,
    choices: architecture.components.map((c) => ({ id: c.id, purpose: c.purpose })),
    nearby,
    does,
  }
}

export function promptFor(question: Question): string {
  const choices = question.choices.map((c) => `- ${c.id}: ${c.purpose || '(no stated purpose)'}`)
  const plural = (n: number) => (n === 1 ? 'file' : 'files')
  const nearby = question.nearby.map(
    (n) =>
      `- ${n.component}: ${n.folder} ${plural(n.folder)} in the same folder, ${n.calls} ${plural(n.calls)} it calls or is called by`,
  )

  return [
    `A new file needs an owner in this architecture. Its path is ${question.path}.`,
    '',
    'These are the components. The purpose is what the component is for.',
    ...choices,
    '',
    question.does.length ? 'This is what the file itself does:' : 'The file has no scanned contents yet.',
    ...question.does.map((line) => `- ${line}`),
    '',
    nearby.length ? 'Counted facts about the files around it:' : 'No neighbouring file has an owner yet.',
    ...nearby,
    '',
    'The counts are facts, not the answer. A file sitting beside a component is not owned by it unless the work it does belongs to that component purpose.',
    'Choose the one component whose stated purpose covers this file work. If no purpose covers it, choose none.',
    'Say certain when the purpose plainly covers it, likely when it is the best fit but another reading is defensible, unsure otherwise.',
    '',
    'Reply with only this JSON and nothing else:',
    '{"component": "<one id from the list above, or null>", "confidence": "certain" | "likely" | "unsure", "why": "<one short sentence>"}',
  ].join('\n')
}

export function judgementOf(text: string, choices: Choice[]): Judgement | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null

  const { component, confidence, why } = parsed as { component?: unknown; confidence?: unknown; why?: unknown }
  if (typeof component !== 'string' || !choices.some((c) => c.id === component)) return null
  if (!CONFIDENCE.includes(confidence as Confidence)) return null

  return { component, confidence: confidence as Confidence, why: typeof why === 'string' ? why.trim() : '' }
}

export const anthropic: Judge = async (question) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  try {
    const text = await ask(apiKey, promptFor(question), MAX_TOKENS, AbortSignal.timeout(TIMEOUT_MS))
    return judgementOf(text, question.choices)
  } catch {
    return null
  }
}

export async function infer(
  path: string,
  architecture: Architecture,
  map: CodeMap,
  judge: Judge = anthropic,
): Promise<Attribution | null> {
  const asked = question(path, architecture, map)
  if (!asked) return null

  let judged: Judgement | null
  try {
    judged = await judge(asked)
  } catch {
    return null
  }

  if (!judged || !asked.choices.some((c) => c.id === judged.component)) return null
  return { path: asked.path, ...judged }
}
