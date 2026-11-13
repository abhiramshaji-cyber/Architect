import type { JevRun } from '../../../shared/jev/types'
import { JevError, type Question, type Reply } from '../client'
import type { Entry, Store } from './cache'
import type { QuestionSet } from './questions'
import type { Target } from './targets'

// cost and rate guard: requests in flight at once for one project
export const CONCURRENCY = 4

export type Ask = (state: string, questions: Record<string, Question>, signal: AbortSignal) => Promise<Reply>

export type IndexInput = { targets: Target[]; set: QuestionSet; store: Store; ask: Ask; signal: AbortSignal; onProgress: (run: JevRun) => void }

export function newestModel(entries: Iterable<Entry>): string | null {
  let newest: Entry | null = null
  for (const entry of entries) if (!newest || entry.at > newest.at) newest = entry
  return newest?.model ?? null
}

export function vectorOf(reply: Reply): Entry['vector'] {
  return Object.fromEntries(Object.entries(reply.answers).flatMap(([id, answer]) => (answer.type === 'choice' ? [[id, answer.probabilities]] : [])))
}

export async function runIndex({ targets, set, store, ask, signal, onProgress }: IndexInput): Promise<JevRun> {
  const cached = store.compact(new Set(targets.map(({ key }) => key)))
  const model = newestModel(cached.values())
  const pending = targets.filter(({ key }) => {
    const entry = cached.get(key)
    return !entry || entry.model !== model
  })
  const run: JevRun = { status: 'running', total: targets.length, done: targets.length - pending.length, sent: 0, failed: 0 }
  onProgress({ ...run })

  const halt = new AbortController()
  const stop = () => halt.abort()
  signal.addEventListener('abort', stop, { once: true })
  let fatal: string | null = null
  let next = 0

  async function work(): Promise<void> {
    while (!halt.signal.aborted && next < pending.length) {
      const job = pending[next++]
      if (!job) return
      try {
        const reply = await ask(job.state, set.questions, halt.signal)
        store.addEntry({ key: job.key, model: reply.model, at: Date.now(), vector: vectorOf(reply) })
        run.done += 1
        run.sent += 1
      } catch (err) {
        if (halt.signal.aborted) return
        if (err instanceof JevError && err.status === 401) {
          fatal = err.message
          halt.abort()
          return
        }
        run.failed += 1
        run.error = err instanceof Error ? err.message : String(err)
      }
      onProgress({ ...run })
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, work))
  signal.removeEventListener('abort', stop)
  const status = fatal ? 'failed' : signal.aborted ? 'stopped' : 'done'
  const done: JevRun = { ...run, status, ...(fatal ? { error: fatal } : {}) }
  onProgress(done)
  return done
}
