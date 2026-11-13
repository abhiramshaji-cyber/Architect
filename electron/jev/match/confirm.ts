import { createHash } from 'node:crypto'
import type { NoulQuestion } from '../client'
import type { Store } from '../classify/cache'
import { CONCURRENCY, type Ask } from '../classify/run'
import type { Target } from '../classify/targets'

export const PAIR_QUESTIONS: Record<string, NoulQuestion> = {
  same: {
    type: 'noul',
    instructions: 'Do these two functions implement the same responsibility, so that a change to that behavior would have to be made in both?',
    criteria: {
      true: 'Both do the same job for the same kind of input, even when written differently or named differently.',
      false: 'They do different jobs, or only share helpers, names, structure or a caller.',
    },
  },
}

const PAIR_VERSION = createHash('sha256').update(JSON.stringify(PAIR_QUESTIONS)).digest('hex').slice(0, 16)

export type Confirmed = { at: number; probability: number }

export type Pairing = { store: Store; ask: Ask; signal: AbortSignal; model: string }

const side = (target: Target) => ({ function: target.name, file: target.file, signature: target.signature, source: target.source })

export function pairKey(a: string, b: string): string {
  return createHash('sha256').update([PAIR_VERSION, ...[a, b].sort()].join('\0')).digest('hex')
}

export async function confirmAll(subject: Target, candidates: Target[], pairing: Pairing): Promise<{ confirmed: Confirmed[]; failed: number }> {
  const known = pairing.store.pairs()
  const confirmed: Confirmed[] = []
  let failed = 0
  let next = 0

  async function asked(other: Target, key: string): Promise<number> {
    const state = JSON.stringify({ first: side(subject), second: side(other) })
    const reply = await pairing.ask(state, PAIR_QUESTIONS, pairing.signal)
    const answer = reply.answers.same
    const noul = answer?.type === 'noul' ? answer.noul : 0
    pairing.store.addPair({ key, a: subject.key, b: other.key, model: reply.model, at: Date.now(), noul })
    return noul
  }

  async function work(): Promise<void> {
    while (!pairing.signal.aborted && next < candidates.length) {
      const other = candidates[next++]
      if (!other) return
      const key = pairKey(subject.key, other.key)
      const cached = known.get(key)
      try {
        const noul = cached?.model === pairing.model ? cached.noul : await asked(other, key)
        confirmed.push({ at: other.at, probability: noul })
      } catch {
        failed += 1
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, work))
  return { confirmed: confirmed.filter((item) => item.probability > 0.5), failed }
}
