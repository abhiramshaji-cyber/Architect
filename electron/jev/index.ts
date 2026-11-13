import type { JevProgress, JevRun, JevState, SameBehavior } from '../../shared/jev/types'
import { readSettings, saveSettings } from '../../shared/settings'
import type { Architecture, CodeMap } from '../../shared/types'
import { storeOf } from './classify/cache'
import { questionsOf } from './classify/questions'
import { runIndex, type Ask } from './classify/run'
import { targetsOf } from './classify/targets'
import { askJev, JevError } from './client'
import { hasKey, readKey, removeKey, storeKey, type Crypt } from './key'
import { findSame } from './match/find'
import { behaviorMarkdown } from './match/render'

export type JevOptions = {
  dir: string
  settings: string
  crypt: Crypt
  load: (root: string) => Promise<{ map: CodeMap; architecture: Architecture | null }>
  onProgress: (progress: JevProgress) => void
  fetch?: typeof fetch
}

export type Jev = ReturnType<typeof createJev>

export const DISABLED = 'Jev is off. Turn it on in the AI page of Architect and add a TypeSafe API key to find functions with the same behavior.'

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

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
  })

  const ask: Ask = (text, questions, signal) => {
    const key = readKey(dir, crypt)
    if (key === null) return Promise.reject(new JevError(401, 'no TypeSafe API key is stored'))
    return askJev(key, text, questions, { fetch: options.fetch ?? fetch, signal })
  }

  function stopAll(): void {
    for (const { stop } of runs.values()) stop.abort()
    for (const stop of asking) stop.abort()
  }

  function index(root: string): JevState {
    if (!ready()) return state(root)
    runs.get(root)?.stop.abort()
    const entry = { run: { status: 'running', total: 0, done: 0, sent: 0, failed: 0 } as JevRun, stop: new AbortController() }
    runs.set(root, entry)
    const report = (run: JevRun) => {
      if (runs.get(root) !== entry) return
      entry.run = run
      options.onProgress({ root, run })
    }

    void (async () => {
      try {
        const { map, architecture } = await options.load(root)
        if (entry.stop.signal.aborted) return report({ ...entry.run, status: 'stopped' })
        const set = questionsOf(architecture)
        const targets = targetsOf(root, map, set.version).filter((target) => !target.test)
        await runIndex({ targets, set, store: storeOf(dir, root), ask, signal: entry.stop.signal, onProgress: report })
      } catch (err) {
        report({ ...entry.run, status: 'failed', error: errorText(err) })
      }
    })()
    return state(root)
  }

  async function same(root: string, file: string, symbol: string): Promise<SameBehavior> {
    if (!ready()) return { status: 'disabled', reason: DISABLED }
    const stop = new AbortController()
    asking.add(stop)
    try {
      const { map, architecture } = await options.load(root)
      return await findSame({ root, map, architecture, file, symbol, store: storeOf(dir, root), ask, signal: stop.signal })
    } finally {
      asking.delete(stop)
    }
  }

  return {
    state,
    index,
    same,
    ready,
    similarBehavior: async (root: string, file: string, symbol: string) => behaviorMarkdown(await same(root, file, symbol)),
    cancel(root: string): JevState {
      runs.get(root)?.stop.abort()
      return state(root)
    },
    setKey(key: unknown): JevState {
      storeKey(dir, crypt, key)
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
      if (!on) stopAll()
      return on && root !== undefined ? index(root) : state(root)
    },
  }
}
