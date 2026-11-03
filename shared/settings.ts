import { readFileSync } from 'node:fs'

export type Settings = { review: boolean }

export function readSettings(file: string): Settings {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return { review: typeof raw === 'object' && raw !== null && (raw as { review?: unknown }).review === true }
  } catch {
    return { review: false }
  }
}
