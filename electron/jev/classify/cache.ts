import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

const entrySchema = z.object({ key: z.string(), model: z.string(), at: z.number(), vector: z.record(z.string(), z.record(z.string(), z.number())) })

const pairSchema = z.object({ key: z.string(), a: z.string(), b: z.string(), model: z.string(), at: z.number(), noul: z.number() })

export type Entry = z.infer<typeof entrySchema>

export type Pair = z.infer<typeof pairSchema>

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

function rewrite(file: string, rows: (Entry | Pair)[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, rows.map((row) => `${JSON.stringify(row)}\n`).join(''), { mode: 0o600 })
  fs.renameSync(temp, file)
}

export function storeOf(dir: string, root: string) {
  const name = `${createHash('sha256').update(path.resolve(root)).digest('hex')}.jsonl`
  const files = { index: path.join(dir, 'index', name), pairs: path.join(dir, 'pairs', name) }
  const entries = () => load(files.index, entrySchema)
  const pairs = () => load(files.pairs, pairSchema)

  return {
    entries,
    pairs,
    addEntry: (entry: Entry) => append(files.index, entry),
    addPair: (pair: Pair) => append(files.pairs, pair),
    compact(live: Set<string>): Map<string, Entry> {
      const index = entries()
      const kept = new Map([...index].filter(([key]) => live.has(key)))
      if (kept.size !== index.size) rewrite(files.index, [...kept.values()])

      const known = pairs()
      const pairing = [...known.values()].filter((pair) => live.has(pair.a) && live.has(pair.b))
      if (pairing.length !== known.size) rewrite(files.pairs, pairing)
      return kept
    },
  }
}
