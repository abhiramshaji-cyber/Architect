import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CodeMap, FileEntry } from '../../shared/types'

export type DescriptionCache = Record<string, string>

const MODEL = 'claude-sonnet-5'
const ENDPOINT = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'
const CONCURRENCY = 6
const SOURCE_LINES = 80
const SOURCE_CHARS = 2400
const ASKS_PER_REQUEST = 40

type Ask = { key: string; hash: string; source: string }

type Job = { file: FileEntry; asks: Ask[] }

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

function prompt(file: FileEntry, asks: Ask[]) {
  const blocks = asks.map((ask) => `<function key="${ask.key}">\n${ask.source}\n</function>`).join('\n\n')
  return [
    `These functions come from ${file.path}.`,
    '',
    blocks,
    '',
    'For each function write one plain English sentence of about 12 words saying what it does for someone using this code.',
    'Do not restate the name, the signature or the types. No jargon, no markdown.',
    'Reply with only a JSON object mapping each key above to its sentence, and nothing else.',
  ].join('\n')
}

function parseSentences(text: string, asks: Ask[]): Map<string, string> {
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

  const wanted = new Map(asks.map((ask) => [ask.key, ask.hash]))
  for (const [key, value] of Object.entries(parsed)) {
    const hash = wanted.get(key)
    if (!hash || typeof value !== 'string') continue
    const sentence = value.trim()
    if (sentence) out.set(hash, sentence)
  }
  return out
}

async function requestFile(apiKey: string, job: Job): Promise<Map<string, string>> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: Math.min(4096, 200 + job.asks.length * 48),
      messages: [{ role: 'user', content: prompt(job.file, job.asks) }],
    }),
  })
  if (!res.ok) return new Map()

  const body = (await res.json()) as unknown
  if ((body as { stop_reason?: unknown }).stop_reason === 'max_tokens') return new Map()

  const content = (body as { content?: unknown }).content
  if (!Array.isArray(content)) return new Map()

  const text = content
    .map((part) => (typeof part === 'object' && part !== null ? (part as { text?: unknown }).text : null))
    .filter((t): t is string => typeof t === 'string')
    .join('')

  return parseSentences(text, job.asks)
}

async function run(apiKey: string, jobs: Job[], cache: DescriptionCache) {
  let cursor = 0

  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++]
      if (!job) return
      try {
        for (const [hash, sentence] of await requestFile(apiKey, job)) cache[hash] = sentence
      } catch {
        continue
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker))
}

export async function describe(
  map: CodeMap,
  root: string,
  cache: DescriptionCache = {},
): Promise<{ map: CodeMap; cache: DescriptionCache }> {
  const next: DescriptionCache = {}
  const hashes = new Map<string, string>()
  const jobs: Job[] = []

  for (const folder of map.folders) {
    for (const file of folder.files) {
      const missing = file.functions.filter((fn) => fn.description === '')
      if (!missing.length) continue

      let lines: string[]
      try {
        lines = fs.readFileSync(path.join(root, file.path), 'utf8').split('\n')
      } catch {
        continue
      }

      const asks: Ask[] = []
      for (const fn of missing) {
        const source = sliceSource(lines, fn.line)
        if (!source.trim()) continue

        const hash = hashOf(`${file.path}\0${fn.name}\0${source}`)
        hashes.set(`${file.path}\0${fnKey(fn.name, fn.line)}`, hash)

        const cached = cache[hash]
        if (cached !== undefined) {
          next[hash] = cached
          continue
        }
        if (asks.some((a) => a.hash === hash)) continue
        asks.push({ key: fnKey(fn.name, fn.line), hash, source })
      }

      for (let at = 0; at < asks.length; at += ASKS_PER_REQUEST) {
        jobs.push({ file, asks: asks.slice(at, at + ASKS_PER_REQUEST) })
      }
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey && jobs.length) await run(apiKey, jobs, next)

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
