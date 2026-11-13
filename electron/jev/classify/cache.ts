import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

const entrySchema = z.object({ key: z.string(), model: z.string(), at: z.number(), vector: z.record(z.string(), z.record(z.string(), z.number())) })

const pairSchema = z.object({ key: z.string(), a: z.string(), b: z.string(), model: z.string(), at: z.number(), noul: z.number() })

const tally = z.number().int().nonnegative().catch(0)

const usageSchema = z.object({ tokens: tally, requests: tally, indexed: tally, total: tally })

export type Entry = z.infer<typeof entrySchema>

export type Pair = z.infer<typeof pairSchema>

export type Usage = z.infer<typeof usageSchema>

export type Store = ReturnType<typeof storeOf>

function load<T extends { key: string }>(file: string, schema: z.ZodType<T>): Map<string, T> {
  const found = new Map<string, T>()
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return found
  }
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const parsed = schema.safeParse(JSON.parse(line))
      if (parsed.success) found.set(parsed.data.key, parsed.data)
    } catch {
      continue
    }
  }
  return found
}

function append(file: string, row: Entry | Pair): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, { mode: 0o600 })
}

function rewrite(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, text, { mode: 0o600 })
  fs.renameSync(temp, file)
}

const lines = (rows: (Entry | Pair)[]) => rows.map((row) => `${JSON.stringify(row)}\n`).join('')

function readUsage(file: string): Usage {
  try {
    return usageSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return { tokens: 0, requests: 0, indexed: 0, total: 0 }
  }
}

export function storeOf(dir: string, root: string) {
  const name = createHash('sha256').update(path.resolve(root)).digest('hex')
  const files = { index: path.join(dir, 'index', `${name}.jsonl`), pairs: path.join(dir, 'pairs', `${name}.jsonl`), usage: path.join(dir, 'usage', `${name}.json`) }
  const entries = () => load(files.index, entrySchema)
  const pairs = () => load(files.pairs, pairSchema)
  const usage = () => readUsage(files.usage)
  const count = (change: Partial<Usage>) => {
    const now = usage()
    rewrite(files.usage, JSON.stringify({ ...now, ...change }))
  }

  return {
    entries,
    pairs,
    usage,
    addEntry: (entry: Entry) => append(files.index, entry),
    addPair: (pair: Pair) => append(files.pairs, pair),
    addTokens: (tokens: number) => {
      const now = usage()
      count({ tokens: now.tokens + Math.max(0, Math.round(tokens)), requests: now.requests + 1 })
    },
    setProgress: (indexed: number, total: number) => count({ indexed, total }),
    compact(live: Set<string>): Map<string, Entry> {
      const index = entries()
      const kept = new Map([...index].filter(([key]) => live.has(key)))
      if (kept.size !== index.size) rewrite(files.index, lines([...kept.values()]))

      const known = pairs()
      const pairing = [...known.values()].filter((pair) => live.has(pair.a) && live.has(pair.b))
      if (pairing.length !== known.size) rewrite(files.pairs, lines(pairing))
      return kept
    },
  }
}
