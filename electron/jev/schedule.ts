import type { JevRun } from '../../shared/jev/types'
import { errorText } from '../../shared/text/error'
import type { CodeMap } from '../../shared/types'
import { storeOf, type Store } from './classify/cache'
import { QUESTIONS } from './classify/questions'
import { endOf, runIndex, type Ask } from './classify/run'
import { targetsOf } from './classify/targets'

export const CLOSED = 'Paused because its window closed. It resumes when the project is open in Architect again.'

export type Scheduling = {
  dir: string
  windows: () => string[]
  ready: () => boolean
  paused: () => string | null
  load: (root: string) => Promise<{ map: CodeMap }>
  ask: (store: Store) => Ask
  emit: (root: string, run: JevRun) => void
}

type Slot = { run: JevRun; stop: AbortController }

export function scheduleOf({ dir, windows, ready, paused, load, ask, emit }: Scheduling) {
  const runs = new Map<string, Slot>()
  const queue: string[] = []
  const asked = new Set<string>()
  let active: string | null = null

  const put = (root: string, run: JevRun): Slot => {
    const slot = { run, stop: new AbortController() }
    runs.set(root, slot)
    emit(root, run)
    return slot
  }
  const settle = (root: string, change: Partial<JevRun>) => put(root, { ...(runs.get(root)?.run ?? { total: 0, done: 0, sent: 0, failed: 0 }), status: 'stopped', ...change })
  const eligible = (root: string, shown = windows()) => shown.includes(root) || asked.has(root)
  const unqueue = (root: string) => queue.splice(queue.indexOf(root), 1)

  function start(root: string): void {
    active = root
    const store = storeOf(dir, root)
    const slot = put(root, { status: 'running', total: 0, done: 0, sent: 0, failed: 0 })
    const report = (run: JevRun) => {
      if (runs.get(root) !== slot) return
      slot.run = run
      if (run.total > 0) store.setProgress(run.done, run.total)
      emit(root, run)
    }

    void (async () => {
      try {
        const { map } = await load(root)
        if (slot.stop.signal.aborted) return report(endOf(slot.run, slot.stop.signal, null))
        const targets = targetsOf(root, map, QUESTIONS.version).filter((target) => !target.test)
        await runIndex({ targets, set: QUESTIONS, store, ask: ask(store), signal: slot.stop.signal, onProgress: report })
      } catch (err) {
        report({ ...slot.run, status: 'failed', error: errorText(err) })
      } finally {
        active = null
        asked.delete(root)
        pump()
      }
    })()
  }

  function pump(): void {
    if (active !== null || paused() !== null || !ready()) return
    const shown = windows()
    const rank = (root: string) => (shown.includes(root) ? shown.indexOf(root) : shown.length)
    const next = queue.filter((root) => eligible(root, shown)).sort((a, b) => rank(a) - rank(b))[0]
    if (next === undefined) return
    unqueue(next)
    start(next)
  }

  function index(root: string): void {
    if (!ready() || paused() !== null || !eligible(root)) return
    if (!queue.includes(root)) {
      queue.push(root)
      const { indexed, total } = storeOf(dir, root).usage()
      if (active !== root) put(root, { status: 'queued', total, done: indexed, sent: 0, failed: 0 })
    }
    pump()
  }

  function indexOpen(again = false): void {
    for (const root of windows()) {
      const run = runs.get(root)?.run
      if (again || !run || run.status === 'paused') index(root)
    }
  }

  return {
    run: (root: string) => runs.get(root)?.run ?? null,
    index,
    indexOpen,
    want(root: string): void {
      if (runs.has(root)) return
      asked.add(root)
      index(root)
    },
    windowsChanged(): void {
      const shown = windows()
      for (const root of queue.filter((at) => !eligible(at, shown))) {
        unqueue(root)
        settle(root, { status: 'paused', error: CLOSED })
      }
      if (active !== null && !eligible(active, shown)) runs.get(active)?.stop.abort(CLOSED)
      indexOpen()
      pump()
    },
    halt(reason?: string): void {
      for (const root of queue.splice(0)) settle(root, reason === undefined ? {} : { status: 'paused', error: reason })
      for (const { stop } of runs.values()) stop.abort(reason)
      for (const [root, { run }] of runs) emit(root, run)
    },
    cancel(root: string): void {
      if (queue.includes(root)) {
        unqueue(root)
        settle(root, {})
      }
      runs.get(root)?.stop.abort()
    },
  }
}
