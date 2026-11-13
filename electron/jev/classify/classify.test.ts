import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scan } from '../../scan/scan'
import { JevError, questionProblem, type Reply } from '../client'
import { storeOf } from './cache'
import { BEHAVIOR_QUESTIONS, BEHAVIORS, QUESTIONS } from './questions'
import { CONCURRENCY, newestModel, runIndex, type Ask } from './run'
import { LONGEST_SOURCE, targetsOf } from './targets'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop() as string, { recursive: true, force: true })
})

function project(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-project-'))
  roots.push(root)
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  return root
}

const FILES = {
  'store/users.ts': "export function loadUser(id: string): string {\n  return read('users', id)\n}\n\nexport function read(table: string, id: string): string {\n  return table + id\n}\n",
  'store/orders.ts': "import { read } from './users'\n\nexport function fetchOrder(id: string): string {\n  return read('orders', id)\n}\n",
  'api/http.ts': "import { loadUser } from '../store/users'\n\nexport function handleUser(id: string) {\n  return loadUser(id)\n}\n",
  'api/http.test.ts': "import { handleUser } from './http'\n\nexport function check() {\n  return handleUser('1')\n}\n",
}

const reply = (model = 'jev-1'): Reply => ({ model, inputTokens: 10, answers: { behavior: { type: 'choice', choice: 'query', probabilities: { ...Object.fromEntries(Object.keys(BEHAVIORS).map((label) => [label, 0])), query: 1 } } } })

const tempStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-store-'))
  roots.push(dir)
  return storeOf(dir, '/some/repo')
}

describe('QUESTIONS', () => {
  it('asks only the four behavior facets, within the Jev limits, with no component question', () => {
    expect(Object.keys(QUESTIONS.questions)).toEqual([...BEHAVIOR_QUESTIONS])
    expect(questionProblem(QUESTIONS.questions)).toBeNull()
  })

  it('has a new version, so every answer cached under the old sets is asked again', () => {
    expect(['54ec472de348eb0f', '4e47e5d5b5256397']).not.toContain(QUESTIONS.version)
  })

  it('keeps every request at a small fixed question cost, whatever the architecture', () => {
    expect(JSON.stringify(QUESTIONS.questions).length).toBeLessThan(2500)
  })
})

describe('targetsOf', () => {
  it('reads each function body with the names of its callers and callees and flags tests', async () => {
    const root = project(FILES)
    const targets = targetsOf(root, await scan(root), 'v1')
    const load = targets.find((target) => target.name === 'loadUser')
    expect(load).toMatchObject({ file: 'store/users.ts', signature: '(id: string): string', inputs: ['string'], output: 'string', callees: ['store/users.ts:read'], callers: ['api/http.ts:handleUser'], test: false })
    expect(load?.source).toBe("export function loadUser(id: string): string {\n  return read('users', id)\n}")
    expect(targets.find((target) => target.name === 'check')?.test).toBe(true)
    expect(JSON.parse(load!.state)).toMatchObject({ function: 'loadUser', calledBy: ['api/http.ts:handleUser'] })
  })

  it('cuts a body longer than the context limit and says how much was left out', async () => {
    const root = project({ 'big.ts': `export function big() {\n  return '${'x'.repeat(LONGEST_SOURCE)}'\n}\n` })
    const [big] = targetsOf(root, await scan(root), 'v1')
    expect(big!.source.length).toBeLessThan(LONGEST_SOURCE + 100)
    expect(big!.source).toMatch(/characters left out/)
  })
})

describe('runIndex', () => {
  it('sends only functions missing from the cache and only the one whose source changed', async () => {
    const root = project(FILES)
    const store = tempStore()
    const set = QUESTIONS
    const ask = vi.fn<Ask>(async () => reply())
    const run = async () => runIndex({ targets: targetsOf(root, await scan(root), set.version).filter((target) => !target.test), set, store, ask, signal: new AbortController().signal, onProgress: () => {} })

    expect(await run()).toMatchObject({ status: 'done', total: 4, done: 4, sent: 4, failed: 0 })
    expect(await run()).toMatchObject({ status: 'done', total: 4, done: 4, sent: 0 })

    fs.writeFileSync(path.join(root, 'store/orders.ts'), "import { read } from './users'\n\nexport function fetchOrder(id: string): string {\n  return read('orders', id.trim())\n}\n")
    expect(await run()).toMatchObject({ status: 'done', sent: 1 })
    expect(ask).toHaveBeenCalledTimes(5)
    expect(store.entries().size).toBe(4)
  })

  it('sends everything again when the question set version changes', async () => {
    const root = project(FILES)
    const store = tempStore()
    const map = await scan(root)
    const ask = vi.fn<Ask>(async () => reply())
    const of = (version: string) => targetsOf(root, map, version).filter((target) => !target.test)
    await runIndex({ targets: of('54ec472de348eb0f'), set: QUESTIONS, store, ask, signal: new AbortController().signal, onProgress: () => {} })
    const again = await runIndex({ targets: of(QUESTIONS.version), set: QUESTIONS, store, ask, signal: new AbortController().signal, onProgress: () => {} })
    expect(again.sent).toBe(4)
    expect(of('54ec472de348eb0f')[0]?.key).not.toBe(of(QUESTIONS.version)[0]?.key)
  })

  it('retries only the functions that failed or were never sent, never a cached success', async () => {
    const root = project(FILES)
    const store = tempStore()
    const targets = targetsOf(root, await scan(root), QUESTIONS.version).filter((target) => !target.test)
    const failing = new Set([targets[1]?.key, targets[3]?.key])
    const first = vi.fn<Ask>(async (state) => (failing.has(targets.find((target) => target.state === state)?.key) ? Promise.reject(new JevError(400, 'too long')) : reply()))
    expect(await runIndex({ targets, set: QUESTIONS, store, ask: first, signal: new AbortController().signal, onProgress: () => {} })).toMatchObject({ status: 'partial', done: 2, sent: 2, failed: 2, error: 'too long' })
    const second = vi.fn<Ask>(async () => reply())
    expect(await runIndex({ targets, set: QUESTIONS, store, ask: second, signal: new AbortController().signal, onProgress: () => {} })).toMatchObject({ status: 'done', done: 4, sent: 2, failed: 0 })
    expect(second.mock.calls.map(([state]) => state).sort()).toEqual([targets[1]?.state, targets[3]?.state].sort())
  })

  it('pauses the whole run on an account error, counts other failures and stops when cancelled', async () => {
    const root = project(FILES)
    const set = QUESTIONS
    const targets = targetsOf(root, await scan(root), set.version).filter((target) => !target.test)

    const refused = vi.fn<Ask>(async () => Promise.reject(new JevError(402, 'TypeSafe returned 402: the account is out of credit')))
    const failed = await runIndex({ targets, set, store: tempStore(), ask: refused, signal: new AbortController().signal, onProgress: () => {} })
    expect(failed).toMatchObject({ status: 'paused', sent: 0, error: 'TypeSafe returned 402: the account is out of credit' })
    expect(refused.mock.calls.length).toBeLessThanOrEqual(CONCURRENCY)

    let calls = 0
    const flaky = vi.fn<Ask>(async () => (++calls === 2 ? Promise.reject(new JevError(400, 'too long')) : reply()))
    expect(await runIndex({ targets, set, store: tempStore(), ask: flaky, signal: new AbortController().signal, onProgress: () => {} })).toMatchObject({ status: 'partial', sent: 3, failed: 1 })

    const stop = new AbortController()
    const slow = vi.fn<Ask>(async (_state, _questions, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))))
    const progress = vi.fn()
    const pending = runIndex({ targets, set, store: tempStore(), ask: slow, signal: stop.signal, onProgress: progress })
    stop.abort()
    expect(await pending).toMatchObject({ status: 'stopped', sent: 0, failed: 0 })
  })

  it('keeps token usage and index progress per project, and starts from zero on a missing or damaged file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-usage-'))
    roots.push(dir)
    const store = storeOf(dir, '/some/repo')
    expect(store.usage()).toEqual({ tokens: 0, requests: 0, indexed: 0, total: 0 })
    store.addTokens(1200)
    store.addTokens(800.4)
    store.setProgress(3, 10)
    expect(storeOf(dir, '/some/repo').usage()).toEqual({ tokens: 2000, requests: 2, indexed: 3, total: 10 })
    expect(storeOf(dir, '/other/repo').usage().tokens).toBe(0)

    const file = fs.readdirSync(path.join(dir, 'usage'))[0] ?? ''
    fs.writeFileSync(path.join(dir, 'usage', file), '{"tokens": -5, "requests": "x"')
    expect(store.usage()).toEqual({ tokens: 0, requests: 0, indexed: 0, total: 0 })
  })

  it('treats the newest model as current', () => {
    expect(newestModel([{ key: 'a', model: 'old', at: 1, vector: {} }, { key: 'b', model: 'new', at: 2, vector: {} }])).toBe('new')
    expect(newestModel([])).toBeNull()
  })
})
