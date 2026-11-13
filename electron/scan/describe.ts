import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CodeMap } from '../../shared/types'
import type { AiRun } from '../ai'

export type DescriptionCache = Record<string, string>

const CONCURRENCY = 3
const SOURCE_LINES = 80
const SOURCE_CHARS = 2400
const ASKS_PER_REQUEST = 40
const RETRY_MS = 5 * 60 * 1000
const TIMEOUT_MS = 4 * 60 * 1000

type Ask = { hash: string; file: string; source: string }

const written = new Map<string, string>()
const asked = new Map<string, number>()

function hashOf(source: string) {
  return createHash('sha256').update(source).digest('hex')
}

function sliceSource(lines: string[], line: number) {
  const start = Math.max(0, line - 1)
  return lines.slice(start, start + SOURCE_LINES).join('\n').slice(0, SOURCE_CHARS)
}

function fnKey(name: string, line: number) {
  return `${name}:${line}`
}

export function prompt(asks: Ask[]) {
  const blocks = asks.map((ask, at) => `<function key="f${at + 1}" file="${ask.file}">\n${ask.source}\n</function>`).join('\n\n')
  return [
    blocks,
    '',
    'For each function above write one plain English sentence of about 12 words saying what it does for someone using this code.',
    'Do not restate the name, the signature or the types. No jargon, no markdown. Run no commands, everything you need is above.',
    'Reply with only a JSON object mapping each key above to its sentence, and nothing else.',
  ].join('\n')
}

export function parseSentences(text: string, asks: Ask[]): Map<string, string> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const out = new Map<string, string>()
  if (start === -1 || end <= start) return out

  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return out
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return out

  const wanted = new Map(asks.map((ask, at) => [`f${at + 1}`, ask.hash]))
  for (const [key, value] of Object.entries(parsed)) {
    const hash = wanted.get(key)
    if (!hash || typeof value !== 'string') continue
    const sentence = value.trim()
    if (sentence) out.set(hash, sentence)
  }
  return out
}

async function fill(run: AiRun, root: string, asks: Ask[], filled?: () => void) {
  const jobs = Array.from({ length: Math.ceil(asks.length / ASKS_PER_REQUEST) }, (_, at) => asks.slice(at * ASKS_PER_REQUEST, (at + 1) * ASKS_PER_REQUEST))
  let cursor = 0
  let stopped = false
  let gained = false

  const worker = async () => {
    while (!stopped && cursor < jobs.length) {
      const job = jobs[cursor++] ?? []
      const out = await Promise.resolve().then(() => run(prompt(job), root, TIMEOUT_MS)).catch(() => null)
      if (out?.code !== 0) {
        stopped = true
        if (out && typeof out.code === 'string' && out.code !== 'timeout') for (const ask of asks) if (!written.has(ask.hash)) asked.delete(ask.hash)
        return
      }
      for (const [hash, sentence] of parseSentences(out.stdout, job)) {
        written.set(hash, sentence)
        gained = true
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker))
  if (gained) filled?.()
}

export function describe(map: CodeMap, root: string, cache: DescriptionCache = {}, run?: AiRun, filled?: () => void): { map: CodeMap; cache: DescriptionCache } {
  const next: DescriptionCache = {}
  const hashes = new Map<string, string>()
  const asks: Ask[] = []
  const now = Date.now()

  for (const file of map.folders.flatMap((folder) => folder.files)) {
    const missing = file.functions.filter((fn) => fn.description === '')
    if (!missing.length) continue

    let lines: string[]
    try {
      lines = fs.readFileSync(path.join(root, file.path), 'utf8').split('\n')
    } catch {
      continue
    }

    for (const fn of missing) {
      const source = sliceSource(lines, fn.line)
      if (!source.trim()) continue

      const hash = hashOf(`${file.path}\0${fn.name}\0${source}`)
      hashes.set(`${file.path}\0${fnKey(fn.name, fn.line)}`, hash)

      const known = cache[hash] ?? written.get(hash)
      if (known !== undefined) next[hash] = known
      if (known !== undefined || !run || now - (asked.get(hash) ?? -Infinity) < RETRY_MS) continue

      asked.set(hash, now)
      asks.push({ hash, file: file.path, source })
    }
  }

  if (run && asks.length) void fill(run, root, asks, filled)

  const described: CodeMap = {
    ...map,
    folders: map.folders.map((folder) => ({
      ...folder,
      files: folder.files.map((file) => ({
        ...file,
        functions: file.functions.map((fn) => {
          if (fn.description !== '') return { ...fn }
          const hash = hashes.get(`${file.path}\0${fnKey(fn.name, fn.line)}`)
          return { ...fn, description: (hash && next[hash]) || '' }
        }),
      })),
    })),
  }

  return { map: described, cache: next }
}
