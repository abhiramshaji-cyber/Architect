import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Architecture } from '../../../shared/types'
import { scan } from '../../scan/scan'
import { JevError, type Question, type Reply } from '../client'
import { storeOf } from './cache'
import { BEHAVIORS, questionsOf } from './questions'
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

const architecture = (purpose: string): Architecture => ({
  title: 't',
  summary: 's',
  components: [
    { id: 'api', purpose, owns: ['api/**'] },
    { id: 'store', purpose: 'The database.', owns: ['store/**'] },
  ],
  edges: [],
  forbidden: [],
  packages: [],
})

const reply = (model = 'jev-1'): Reply => ({ model, inputTokens: 10, answers: { behavior: { type: 'choice', choice: 'query', probabilities: { ...Object.fromEntries(Object.keys(BEHAVIORS).map((label) => [label, 0])), query: 1 } } } })

const tempStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-store-'))
  roots.push(dir)
  return storeOf(dir, '/some/repo')
}

describe('questionsOf', () => {
  it('asks the generic behavior question alone without at least two components', () => {
    expect(Object.keys(questionsOf(null).questions)).toEqual(['behavior'])
    expect(Object.keys(questionsOf({ ...architecture('x'), components: [architecture('x').components[0]!] }).questions)).toEqual(['behavior'])
  })

  it('labels responsibility with the component ids and their own purpose, clipped to the Jev limit', () => {
    const { questions, version } = questionsOf(architecture(`The http surface. ${'word '.repeat(200)}`))
    const criteria = questions.responsibility?.criteria ?? {}
    expect(Object.keys(criteria)).toEqual(['api', 'store'])
    expect(criteria.api?.length).toBe(500)
    expect(criteria.api?.endsWith('…')).toBe(true)
    expect(questionsOf(architecture('Something else')).version).not.toBe(version)
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
    const set = questionsOf(null)
    const ask = vi.fn<Ask>(async () => reply())
    const run = async () => runIndex({ targets: targetsOf(root, await scan(root), set.version).filter((target) => !target.test), set, store, ask, signal: new AbortController().signal, onProgress: () => {} })

    expect(await run()).toMatchObject({ status: 'done', total: 4, done: 4, sent: 4, failed: 0 })
    expect(await run()).toMatchObject({ status: 'done', total: 4, done: 4, sent: 0 })

    fs.writeFileSync(path.join(root, 'store/orders.ts'), "import { read } from './users'\n\nexport function fetchOrder(id: string): string {\n  return read('orders', id.trim())\n}\n")
    expect(await run()).toMatchObject({ status: 'done', sent: 1 })
    expect(ask).toHaveBeenCalledTimes(5)
    expect(store.entries().size).toBe(4)
  })

  it('sends everything again when the question set changes', async () => {
    const root = project(FILES)
    const store = tempStore()
    const map = await scan(root)
    const ask = vi.fn<Ask>(async (_state, questions: Record<string, Question>) => ({ ...reply(), answers: { ...reply().answers, ...(questions.responsibility ? { responsibility: { type: 'choice' as const, choice: 'api', probabilities: { api: 1, store: 0 } } } : {}) } }))
    const bare = questionsOf(null)
    const drawn = questionsOf(architecture('The http surface.'))
    const of = (version: string) => targetsOf(root, map, version).filter((target) => !target.test)
    await runIndex({ targets: of(bare.version), set: bare, store, ask, signal: new AbortController().signal, onProgress: () => {} })
    const again = await runIndex({ targets: of(drawn.version), set: drawn, store, ask, signal: new AbortController().signal, onProgress: () => {} })
    expect(again.sent).toBe(4)
    expect(of(bare.version)[0]?.key).not.toBe(of(drawn.version)[0]?.key)
  })

  it('stops the whole run on a refused key, counts other failures and stops when cancelled', async () => {
    const root = project(FILES)
    const set = questionsOf(null)
    const targets = targetsOf(root, await scan(root), set.version).filter((target) => !target.test)

    const refused = vi.fn<Ask>(async () => Promise.reject(new JevError(401, 'TypeSafe refused the API key')))
    const failed = await runIndex({ targets, set, store: tempStore(), ask: refused, signal: new AbortController().signal, onProgress: () => {} })
    expect(failed).toMatchObject({ status: 'failed', sent: 0, error: 'TypeSafe refused the API key' })
    expect(refused.mock.calls.length).toBeLessThanOrEqual(CONCURRENCY)

    let calls = 0
    const flaky = vi.fn<Ask>(async () => (++calls === 2 ? Promise.reject(new JevError(400, 'too long')) : reply()))
    expect(await runIndex({ targets, set, store: tempStore(), ask: flaky, signal: new AbortController().signal, onProgress: () => {} })).toMatchObject({ status: 'done', sent: 3, failed: 1 })

    const stop = new AbortController()
    const slow = vi.fn<Ask>(async (_state, _questions, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))))
    const progress = vi.fn()
    const pending = runIndex({ targets, set, store: tempStore(), ask: slow, signal: stop.signal, onProgress: progress })
    stop.abort()
    expect(await pending).toMatchObject({ status: 'stopped', sent: 0, failed: 0 })
  })

  it('treats the newest model as current', () => {
    expect(newestModel([{ key: 'a', model: 'old', at: 1, vector: {} }, { key: 'b', model: 'new', at: 2, vector: {} }])).toBe('new')
    expect(newestModel([])).toBeNull()
  })
})
