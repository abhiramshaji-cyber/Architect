import type { DraftFailure, FunctionFacts, FunctionRank } from '../../shared/types'
import type { ClaudeRun } from '../draft/draft'
import { type Ask, FUNCTIONS_PER_CALL, parseRanks, promptFor, sourceOf } from './prompt'

export const RANK_MODEL = 'haiku'

const TIMEOUT_MS = 3 * 60 * 1000
const MAX_STDERR = 400

export type FileRanking = {
  ranks: (FunctionRank | null)[]
  failure: DraftFailure | null
}

function failureOf(code: number | 'missing' | 'timeout', stderr: string): DraftFailure {
  if (code === 'missing') return { kind: 'not-installed' }
  if (code === 'timeout') return { kind: 'timed-out' }
  return { kind: 'failed', code, stderr: stderr.trim().slice(0, MAX_STDERR) }
}

export async function rankFile(
  project: string,
  root: string,
  file: string,
  facts: FunctionFacts[],
  text: string,
  run: ClaudeRun,
  signal?: AbortSignal,
): Promise<FileRanking> {
  const lines = text.split('\n')
  const asks: Ask[] = facts.map((f, at) => ({
    id: `f${at}`,
    facts: f,
    source: sourceOf(lines, f),
  }))
  const ranks: (FunctionRank | null)[] = facts.map(() => null)
  let failure: DraftFailure | null = null

  for (let at = 0; at < asks.length; at += FUNCTIONS_PER_CALL) {
    if (signal?.aborted) break
    const batch = asks.slice(at, at + FUNCTIONS_PER_CALL)
    const out = await run(promptFor(project, file, batch), root, TIMEOUT_MS, RANK_MODEL, signal)

    if (out.code !== 0) {
      failure = failureOf(out.code, out.stderr)
      if (out.code === 'missing') break
      continue
    }

    const found = parseRanks(
      out.stdout,
      batch.map((ask) => ask.id),
    )
    if (found.size === 0)
      failure = {
        kind: 'unusable',
        detail: `no usable ranking came back for ${file}`,
      }
    batch.forEach((ask, offset) => {
      ranks[at + offset] = found.get(ask.id) ?? null
    })
  }

  return { ranks, failure }
}
