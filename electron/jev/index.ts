import type { JevProgress, JevRun, JevState, JevStatus, JevUsage, SameBehavior } from '../../shared/jev/types'
import { readSettings, saveSettings } from '../../shared/settings'
import { errorText } from '../../shared/text/error'
import type { Architecture, CodeMap } from '../../shared/types'
import { storeOf, type Store } from './classify/cache'
import { questionsOf } from './classify/questions'
import { runIndex, type Ask } from './classify/run'
import { targetsOf } from './classify/targets'
import { askJev, JevError, PRICE_PER_MILLION_INPUT_TOKENS } from './client'
import { hasKey, readKey, removeKey, storeKey, type Crypt } from './key'
import { findSame } from './match/find'
import { behaviorMarkdown } from './match/render'

export type JevOptions = {
  dir: string
  settings: string
  crypt: Crypt
  load: (root: string) => Promise<{ map: CodeMap; architecture: Architecture | null }>
  projects: () => string[]
  onProgress: (progress: JevProgress) => void
  fetch?: typeof fetch
}

export type Jev = ReturnType<typeof createJev>

export const DISABLED = 'Jev is off. Turn it on in the AI page of Architect and add a TypeSafe API key to find functions with the same behavior.'

export const costOf = (tokens: number) => (tokens / 1_000_000) * PRICE_PER_MILLION_INPUT_TOKENS

function usageOf(store: Store): JevUsage {
  const { indexed, total, tokens, requests } = store.usage()
  return { indexed, total, tokens, requests, cost: costOf(tokens) }
}

export function createJev(options: JevOptions) {
  const { dir, crypt } = options
  const runs = new Map<string, { run: JevRun; stop: AbortController }>()
  const asking = new Set<AbortController>()

  const enabled = () => readSettings(options.settings).jev
  const ready = () => enabled() && hasKey(dir)
  const state = (root?: string): JevState => ({
    enabled: enabled(),
    key: { set: hasKey(dir) },
    encryption: crypt.isEncryptionAvailable(),
    run: root === undefined ? null : (runs.get(root)?.run ?? null),
    usage: root === undefined ? null : usageOf(storeOf(dir, root)),
  })

  const askIn = (store: Store): Ask => async (text, questions, signal) => {
    const key = readKey(dir, crypt)
    if (key === null) throw new JevError(401, 'no TypeSafe API key is stored')
    const reply = await askJev(key, text, questions, { fetch: options.fetch ?? fetch, signal })
    store.addTokens(reply.inputTokens)
    return reply
  }

  function stopAll(): void {
    for (const { stop } of runs.values()) stop.abort()
    for (const stop of asking) stop.abort()
  }

  function index(root: string): JevState {
    if (!ready()) return state(root)
    runs.get(root)?.stop.abort()
    const store = storeOf(dir, root)
    const entry = { run: { status: 'running', total: 0, done: 0, sent: 0, failed: 0 } as JevRun, stop: new AbortController() }
    runs.set(root, entry)
    const report = (run: JevRun) => {
      if (runs.get(root) !== entry) return
      entry.run = run
      if (run.total > 0) store.setProgress(run.done, run.total)
      options.onProgress({ root, run, usage: usageOf(store) })
    }

    void (async () => {
      try {
        const { map, architecture } = await options.load(root)
        if (entry.stop.signal.aborted) return report({ ...entry.run, status: 'stopped' })
        const set = questionsOf(architecture)
        const targets = targetsOf(root, map, set.version).filter((target) => !target.test)
        await runIndex({ targets, set, store, ask: askIn(store), signal: entry.stop.signal, onProgress: report })
      } catch (err) {
        report({ ...entry.run, status: 'failed', error: errorText(err) })
      }
    })()
    return state(root)
  }

  function indexOpen(again = false, extra?: string): void {
    if (!ready()) return
    for (const root of new Set([...options.projects(), ...(extra ? [extra] : [])])) if (again || !runs.has(root)) index(root)
  }

  async function same(root: string, file: string, symbol: string): Promise<SameBehavior> {
    if (!ready()) return { status: 'disabled', reason: DISABLED }
    if (!runs.has(root)) index(root)
    const stop = new AbortController()
    asking.add(stop)
    try {
      const { map, architecture } = await options.load(root)
      const store = storeOf(dir, root)
      return await findSame({ root, map, architecture, file, symbol, store, ask: askIn(store), signal: stop.signal, run: runs.get(root)?.run ?? null })
    } finally {
      asking.delete(stop)
    }
  }

  function status(root: string): JevStatus {
    const run = runs.get(root)?.run
    const { indexed, total, tokens, requests, cost } = usageOf(storeOf(dir, root))
    return {
      enabled: enabled(),
      key: { set: hasKey(dir) },
      root,
      index: run ? { status: run.status, indexed: run.done, total: run.total, failed: run.failed, ...(run.error ? { error: run.error } : {}) } : { status: 'idle', indexed, total, failed: 0 },
      usage: { tokens, requests, cost, pricePerMillionInputTokens: PRICE_PER_MILLION_INPUT_TOKENS },
    }
  }

  return {
    state,
    index,
    indexOpen,
    same,
    status,
    ready,
    similarBehavior: async (root: string, file: string, symbol: string) => behaviorMarkdown(await same(root, file, symbol)),
    cancel(root: string): JevState {
      runs.get(root)?.stop.abort()
      return state(root)
    },
    setKey(key: unknown): JevState {
      storeKey(dir, crypt, key)
      indexOpen(true)
      return state()
    },
    removeKey(): JevState {
      stopAll()
      removeKey(dir)
      return state()
    },
    setEnabled(on: boolean, root?: string): JevState {
      if (on && !hasKey(dir)) throw new Error('add a TypeSafe API key before turning Jev on')
      saveSettings(options.settings, { jev: on })
      if (on) indexOpen(true, root)
      else stopAll()
      return state(root)
    },
  }
}
