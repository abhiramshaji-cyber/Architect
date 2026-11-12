import fs from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'

function persist(target: string, text: string) {
  const temporary = `${target}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(target), { recursive: true })
  try {
    fs.writeFileSync(temporary, text)
    fs.renameSync(temporary, target)
  } catch (err) {
    fs.rmSync(temporary, { force: true })
    throw err
  }
}

export function createJournal<T>(fileOf: (root: string) => string, schema: z.ZodType<T>, limit: number) {
  const loaded = new Map<string, T[]>()

  function list(root: string): T[] {
    const known = loaded.get(root)
    if (known) return known

    let stored: unknown
    try {
      stored = JSON.parse(fs.readFileSync(fileOf(root), 'utf8'))
    } catch {
      stored = []
    }
    const entries = Array.isArray(stored) ? stored.flatMap((raw) => schema.safeParse(raw).data ?? []).slice(0, limit) : []
    loaded.set(root, entries)
    return entries
  }

  function append(root: string, entry: T): T[] {
    const entries = [entry, ...list(root)].slice(0, limit)
    loaded.set(root, entries)

    try {
      persist(fileOf(root), JSON.stringify(entries))
    } catch (err) {
      console.error(`could not persist ${fileOf(root)}:`, err instanceof Error ? err.message : String(err))
    }
    return entries
  }

  return { list, append }
}
