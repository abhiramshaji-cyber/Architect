import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type Settings = { review: boolean; conventions: boolean }

function stored(file: string): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function readSettings(file: string): Settings {
  const raw = stored(file)
  return { review: raw.review === true, conventions: raw.conventions === true }
}

export function saveSettings(file: string, patch: Partial<Settings>): void {
  const kept = stored(file)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ ...kept, ...patch }, null, 2)}\n`)
}
