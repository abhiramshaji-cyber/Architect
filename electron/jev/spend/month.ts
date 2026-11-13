import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

const monthSchema = z.object({ month: z.string(), tokens: z.number().int().nonnegative() })

const fileIn = (dir: string) => path.join(dir, 'usage', 'month.json')

const monthOf = (now: Date) => now.toISOString().slice(0, 7)

export function monthTokens(dir: string, now = new Date()): number {
  try {
    const kept = monthSchema.parse(JSON.parse(fs.readFileSync(fileIn(dir), 'utf8')))
    return kept.month === monthOf(now) ? kept.tokens : 0
  } catch {
    return 0
  }
}

export function addMonthTokens(dir: string, tokens: number, now = new Date()): void {
  const file = fileIn(dir)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify({ month: monthOf(now), tokens: monthTokens(dir, now) + Math.max(0, Math.round(tokens)) }), { mode: 0o600 })
  fs.renameSync(temp, file)
}
