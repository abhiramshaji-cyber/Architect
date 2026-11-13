import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DraftFailure } from './types'

export const PROVIDERS = ['claude', 'codex'] as const

export type Provider = (typeof PROVIDERS)[number]

export const DEFAULT_MODELS: Record<Provider, string> = { claude: 'haiku', codex: 'gpt-6-luna' }

export type AiChoice = { connected: boolean; provider: Provider; models: Record<Provider, string> }

export type Login = 'ready' | 'missing' | 'logged-out' | 'api-key' | 'unreadable'

export type CliStatus = { provider: Provider; login: Login; detail: string; models: string[] }

export type AiFailure = { reason: DraftFailure; at: number }

export type AiState = { choice: AiChoice; clis: CliStatus[]; failure: AiFailure | null }

export type Settings = { review: boolean; conventions: boolean; ai: AiChoice; jev: boolean; jevBudget: number | null }

export const jevBudgetOf = (raw: unknown): number | null => (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? raw : null)

function stored(file: string): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function isProvider(value: unknown): value is Provider {
  return PROVIDERS.some((provider) => provider === value)
}

export function aiChoiceOf(raw: unknown): AiChoice {
  const ai = typeof raw === 'object' && raw !== null ? (raw as { connected?: unknown; provider?: unknown; models?: unknown }) : {}
  const models = typeof ai.models === 'object' && ai.models !== null ? (ai.models as Record<string, unknown>) : {}
  const model = (provider: Provider) => {
    const value = models[provider]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULT_MODELS[provider]
  }
  const provider = isProvider(ai.provider) ? ai.provider : 'claude'
  return { connected: ai.connected === true, provider, models: { claude: model('claude'), codex: model('codex') } }
}

export function readSettings(file: string): Settings {
  const raw = stored(file)
  return { review: raw.review === true, conventions: raw.conventions === true, ai: aiChoiceOf(raw.ai), jev: raw.jev === true, jevBudget: jevBudgetOf(raw.jevBudget) }
}

export function saveSettings(file: string, patch: Partial<Settings>): void {
  const kept = stored(file)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ ...kept, ...patch }, null, 2)}\n`)
}
