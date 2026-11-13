import path from 'node:path'
import { type AiState, aiChoiceOf, PROVIDERS, readSettings, saveSettings } from '../../shared/settings'
import { lastFailure } from './run'
import { statusOf } from './status'

export { aiRun, type AiOutput, type AiRun, failureOf } from './run'

const fileIn = (dir: string) => path.join(dir, 'settings.json')

export async function aiState(dir: string): Promise<AiState> {
  const clis = await Promise.all(PROVIDERS.map(statusOf))
  return { choice: readSettings(fileIn(dir)).ai, clis, failure: lastFailure }
}

export async function chooseAi(dir: string, choice: unknown): Promise<AiState> {
  saveSettings(fileIn(dir), { ai: aiChoiceOf(choice) })
  return aiState(dir)
}
