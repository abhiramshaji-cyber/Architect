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

export type Checked = { at: number; probability: number }

export type Pairing = { store: Store; ask: Ask; signal: AbortSignal; model: string; guard: number }

export type Confirmation = { checked: Checked[]; failed: number; unchecked: number }

const side = (target: Target) => ({ function: target.name, file: target.file, signature: target.signature, source: target.source })

export function pairKey(a: string, b: string): string {
  return createHash('sha256').update([PAIR_VERSION, ...[a, b].sort()].join('\0')).digest('hex')
}

export async function confirmAll(subject: Target, candidates: Target[], pairing: Pairing): Promise<Confirmation> {
  const known = pairing.store.pairs()
  const checked: Checked[] = []
  const unknown: { other: Target; key: string }[] = []
  for (const other of candidates) {
    const key = pairKey(subject.key, other.key)
    const cached = known.get(key)
    if (cached?.model === pairing.model) checked.push({ at: other.at, probability: cached.noul })
    else unknown.push({ other, key })
  }

  const asking = unknown.slice(0, pairing.guard)
  let failed = 0
  let next = 0
  async function work(): Promise<void> {
    while (!pairing.signal.aborted && next < asking.length) {
      const job = asking[next++]
      if (!job) return
      try {
        const reply = await pairing.ask(JSON.stringify({ first: side(subject), second: side(job.other) }), PAIR_QUESTIONS, pairing.signal)
        const answer = reply.answers.same
        const noul = answer?.type === 'noul' ? answer.noul : 0
        pairing.store.addPair({ key: job.key, a: subject.key, b: job.other.key, model: reply.model, at: Date.now(), noul })
        checked.push({ at: job.other.at, probability: noul })
      } catch {
        failed += 1
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, asking.length) }, work))
  return { checked, failed, unchecked: unknown.length - asking.length }
}
