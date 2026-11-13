import type { JevBudget, JevProgress, JevRun, JevState, JevStatus, JevUsage, SameBehavior } from '../../shared/jev/types'
import { jevBudgetOf, readSettings, saveSettings } from '../../shared/settings'
import type { Architecture, CodeMap } from '../../shared/types'
import { storeOf, type Store } from './classify/cache'
import { PRICE_PER_MILLION_INPUT_TOKENS } from './client'
import { hasKey, removeKey, storeKey, type Crypt } from './key'
import { findSame } from './match/find'
import { behaviorMarkdown } from './match/render'
import { scheduleOf } from './schedule'
import { monthTokens } from './spend/month'
import { gateOf } from './spend/gate'

export type JevOptions = {
  dir: string
  settings: string
  crypt: Crypt
  load: (root: string) => Promise<{ map: CodeMap; architecture: Architecture | null }>
  windows: () => string[]
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
  const asking = new Set<AbortController>()
  let paused: string | null = null

  const enabled = () => readSettings(options.settings).jev
  const limit = () => readSettings(options.settings).jevBudget
  const ready = () => enabled() && hasKey(dir)
  const held = (): SameBehavior | null => (paused === null ? null : { status: 'paused', reason: paused })
  const budget = (): JevBudget => {
    const tokens = monthTokens(dir)
    return { limit: limit(), tokens, cost: costOf(tokens) }
  }
  const emit = (root: string, run: JevRun) => options.onProgress({ root, run, usage: usageOf(storeOf(dir, root)), paused, budget: budget() })

  function pause(reason: string): void {
    if (paused !== null) return
    paused = reason
    for (const stop of asking) stop.abort(reason)
    schedule.halt(reason)
  }

  const ask = gateOf({ dir, crypt, fetch: options.fetch ?? fetch, limit, paused: () => paused, pause })
  const schedule = scheduleOf({ dir, windows: options.windows, ready, paused: () => paused, load: options.load, ask, emit })

  const state = (root?: string): JevState => ({
    enabled: enabled(),
    key: { set: hasKey(dir) },
    encryption: crypt.isEncryptionAvailable(),
    paused,
    budget: budget(),
    run: root === undefined ? null : schedule.run(root),
    usage: root === undefined ? null : usageOf(storeOf(dir, root)),
  })

  function stopAll(): void {
    for (const stop of asking) stop.abort()
    schedule.halt()
  }

  function retry(root?: string): JevState {
    paused = null
    if (root) schedule.index(root)
    schedule.indexOpen(true)
    return state(root)
  }

  async function same(root: string, file: string, symbol: string): Promise<SameBehavior> {
    if (!ready()) return { status: 'disabled', reason: DISABLED }
    const before = held()
    if (before) return before
    schedule.want(root)
    const stop = new AbortController()
    asking.add(stop)
    try {
      const { map, architecture } = await options.load(root)
      const store = storeOf(dir, root)
      const found = await findSame({ root, map, architecture, file, symbol, store, ask: ask(store), signal: stop.signal, run: schedule.run(root) })
      return held() ?? found
    } catch (err) {
      const during = held()
      if (during) return during
      throw err
    } finally {
      asking.delete(stop)
    }
  }

  function status(root: string): JevStatus {
    const run = schedule.run(root)
    const { indexed, total, tokens, requests, cost } = usageOf(storeOf(dir, root))
    return {
      enabled: enabled(),
      key: { set: hasKey(dir) },
      root,
      paused,
      index: run ? { status: run.status, indexed: run.done, total: run.total, failed: run.failed, ...(run.error ? { error: run.error } : {}) } : { status: 'idle', indexed, total, failed: 0 },
      usage: { tokens, requests, cost, pricePerMillionInputTokens: PRICE_PER_MILLION_INPUT_TOKENS },
      budget: budget(),
    }
  }

  return {
    state,
    same,
    status,
    ready,
    retry,
    index: (root: string) => {
      schedule.index(root)
      return state(root)
    },
    indexOpen: () => schedule.indexOpen(),
    windowsChanged: () => schedule.windowsChanged(),
    similarBehavior: async (root: string, file: string, symbol: string) => behaviorMarkdown(await same(root, file, symbol)),
    cancel(root: string): JevState {
      schedule.cancel(root)
      return state(root)
    },
    setBudget(tokens: unknown): JevState {
      const jevBudget = tokens === null ? null : jevBudgetOf(tokens)
      if (tokens !== null && jevBudget === null) throw new Error('the monthly budget must be a whole number of input tokens above zero, or empty to turn it off')
      saveSettings(options.settings, { jevBudget })
      return retry()
    },
    setKey(key: unknown): JevState {
      storeKey(dir, crypt, key)
      return retry()
    },
    removeKey(): JevState {
      stopAll()
      removeKey(dir)
      return state()
    },
    setEnabled(on: boolean, root?: string): JevState {
      if (on && !hasKey(dir)) throw new Error('add a TypeSafe API key before turning Jev on')
      saveSettings(options.settings, { jev: on })
      if (on) return retry(root)
      stopAll()
      return state(root)
    },
  }
}
