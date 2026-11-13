import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JevProgress } from '../../shared/jev/types'
import { scan } from '../scan/scan'
import { PRICE_PER_MILLION_INPUT_TOKENS } from './client'
import { createJev, DISABLED, type JevOptions } from '.'
import { trustedSender, wireJevIpc } from './ipc'
import type { Crypt } from './key'

const handlers = vi.hoisted(() => new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>())

vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, fn) } }))

const KEY = 'ts-SENTINEL-key-0123456789'

const crypt: Crypt = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(Buffer.from(text).reverse().toString('base64')),
  decryptString: (data) => Buffer.from(data.toString(), 'base64').reverse().toString(),
}

const dirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  handlers.clear()
  while (dirs.length > 0) fs.rmSync(dirs.pop() as string, { recursive: true, force: true })
})

function temp(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-'))
  dirs.push(dir)
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text)
  return dir
}

function setup(fetch: typeof globalThis.fetch, home = temp()) {
  const root = temp({ 'a.ts': 'export function load(id: string) {\n  return id\n}\n\nexport function fetchIt(id: string) {\n  return id\n}\n' })
  const progress: JevProgress[] = []
  const load = vi.fn(async (at: string) => ({ map: await scan(at), architecture: null }))
  const options: JevOptions = { dir: path.join(home, 'jev'), settings: path.join(home, 'settings.json'), crypt, load, windows: () => [root], onProgress: (event) => progress.push(event), fetch }
  return { jev: createJev(options), root, home, progress, load, options }
}

const everyFile = (dir: string): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name)) : []

describe('off path', () => {
  it('makes no network call while off, with or without a key, and says it is disabled', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const { jev, root, load, options } = setup(fetch)

    expect(jev.state(root)).toEqual({ enabled: false, key: { set: false }, encryption: true, paused: null, budget: { limit: null, tokens: 0, cost: 0 }, run: null, usage: { indexed: 0, total: 0, tokens: 0, requests: 0, cost: 0 } })
    jev.indexOpen()
    expect(jev.index(root).run).toBeNull()
    expect(await jev.same(root, 'a.ts', 'load')).toEqual({ status: 'disabled', reason: DISABLED })
    expect(await jev.similarBehavior(root, 'a.ts', 'load')).toBe(DISABLED)
    expect(() => jev.setEnabled(true, root)).toThrow(/add a TypeSafe API key/)

    jev.setKey(KEY)
    expect(jev.index(root).run).toBeNull()
    expect(await jev.same(root, 'a.ts', 'load')).toMatchObject({ status: 'disabled' })

    jev.removeKey()
    fs.writeFileSync(options.settings, JSON.stringify({ jev: true }))
    jev.indexOpen()
    expect(jev.state().enabled).toBe(true)
    expect(jev.index(root).run).toBeNull()
    expect(await jev.similarBehavior(root, 'a.ts', 'load')).toBe(DISABLED)

    expect(fetch).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  })
})

const answer = (labels: string[]) => ({ type: 'choice', choice: labels[0], probabilities: Object.fromEntries(labels.map((label, i) => [label, i === 0 ? 1 : 0])) })

function replying(tokens: number) {
  return vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    const { questions } = JSON.parse(String(init?.body)) as { questions: Record<string, { type: string; criteria: Record<string, string> }> }
    const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, question.type === 'noul' ? { type: 'noul', noul: 0.1 } : answer(Object.keys(question.criteria))]))
    return new Response(JSON.stringify({ model: 'jev-1', answers, usage: { input_tokens: tokens } }), { status: 200 })
  })
}

describe('auto index', () => {
  it('indexes every open project as soon as Jev is on with a key, and not again while a run exists', async () => {
    const fetch = replying(50)
    const { jev, root, progress } = setup(fetch)
    jev.setKey(KEY)
    expect(progress).toEqual([])
    jev.setEnabled(true)
    await vi.waitFor(() => expect(progress.at(-1)?.run).toMatchObject({ status: 'done', done: 2, total: 2 }))
    expect(progress.every((event) => event.root === root)).toBe(true)

    const calls = fetch.mock.calls.length
    jev.indexOpen()
    expect(fetch.mock.calls.length).toBe(calls)
  })

  it('starts at app launch for a project that opens while Jev is already on, and resumes from the cache', async () => {
    const home = temp()
    const first = setup(replying(50), home)
    first.jev.setKey(KEY)
    first.jev.setEnabled(true)
    await vi.waitFor(() => expect(first.progress.at(-1)?.run.status).toBe('done'))

    const fetch = replying(50)
    const launched = createJev({ ...first.options, fetch, windows: () => [first.root], onProgress: (event) => first.progress.push(event) })
    first.progress.length = 0
    launched.indexOpen()
    await vi.waitFor(() => expect(first.progress.at(-1)?.run).toMatchObject({ status: 'done', done: 2, sent: 0 }))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('starts an index when asked for the same behavior with none running, and reports its progress', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Promise<Response>(() => {}))
    const { jev, root, load, options } = setup(fetch)
    jev.setKey(KEY)
    const quiet = createJev({ ...options, windows: () => [] })
    quiet.setEnabled(true)
    const found = await quiet.same(root, 'a.ts', 'load')
    expect(found).toEqual({ status: 'unindexed', reason: 'Jev is indexing this project: 0 of 2 functions classified so far, none of the other 1 yet. Ask again in a moment.' })
    expect(quiet.status(root).index).toEqual({ status: 'running', indexed: 0, total: 2, failed: 0 })
    expect(load).toHaveBeenCalled()
    quiet.setEnabled(false)
  })
})

describe('usage', () => {
  it('counts input tokens from every reply per project, persists them and prices them from one constant', async () => {
    const home = temp()
    const { jev, root, progress, options } = setup(replying(1_000_000), home)
    jev.setKey(KEY)
    jev.setEnabled(true)
    await vi.waitFor(() => expect(progress.at(-1)?.run.status).toBe('done'))

    const usage = { indexed: 2, total: 2, tokens: 2_000_000, requests: 2, cost: 2 * PRICE_PER_MILLION_INPUT_TOKENS }
    expect(progress.at(-1)?.usage).toEqual(usage)
    expect(createJev(options).state(root).usage).toEqual(usage)
    expect(PRICE_PER_MILLION_INPUT_TOKENS).toBe(0.042)
    expect(jev.status(root)).toEqual({
      enabled: true,
      key: { set: true },
      root,
      paused: null,
      index: { status: 'done', indexed: 2, total: 2, failed: 0 },
      usage: { tokens: 2_000_000, requests: 2, cost: 2 * PRICE_PER_MILLION_INPUT_TOKENS, pricePerMillionInputTokens: PRICE_PER_MILLION_INPUT_TOKENS },
      budget: { limit: null, tokens: 2_000_000, cost: 2 * PRICE_PER_MILLION_INPUT_TOKENS },
    })
    expect(createJev(options).status(root).index).toEqual({ status: 'idle', indexed: 2, total: 2, failed: 0 })
  })
})

describe('key safety', () => {
  it('never puts the key in a return value, progress event, error, log line or file other than the sealed key', async () => {
    const logged = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}))
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ detail: `rejected ${KEY}` }), { status: 400 }))
    const { jev, root, home, progress } = setup(fetch)

    const returned: unknown[] = [jev.setKey(KEY), jev.setEnabled(true, root)]
    await vi.waitFor(() => expect(progress.at(-1)?.run.status).toBe('partial'))
    returned.push(jev.state(root), jev.status(root), await jev.same(root, 'a.ts', 'load').catch((err: unknown) => String(err)), await jev.similarBehavior(root, 'a.ts', 'load').catch((err: unknown) => String(err)))

    const authorization = (fetch.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization
    expect(authorization).toBe(`Bearer ${KEY}`)
    expect(progress.at(-1)?.run.error).toBe('TypeSafe answered 400: rejected …')

    const files = everyFile(home).filter((file) => path.basename(file) !== 'key.bin')
    const seen = [JSON.stringify(returned), JSON.stringify(progress), JSON.stringify(logged.map((spy) => spy.mock.calls)), ...files.map((file) => fs.readFileSync(file, 'utf8'))]
    for (const text of seen) expect(text).not.toContain(KEY)
    expect(fs.readFileSync(path.join(home, 'jev', 'key.bin'), 'utf8')).not.toContain(KEY)
  })

  it('answers IPC from Architect windows only and never returns the key over it', async () => {
    const { jev, root } = setup(vi.fn<typeof globalThis.fetch>(async () => new Response('{}', { status: 401 })))
    wireJevIpc(jev)
    const trusted = { senderFrame: { url: pathToFileURL(path.join(import.meta.dirname, '../renderer/index.html')).href } }
    const stranger = { senderFrame: { url: 'https://evil.example/' } }
    const call = (channel: string, event: unknown, ...args: unknown[]) => handlers.get(channel)?.(event, ...args)

    expect(await call('architect:jev-set-key', stranger, KEY)).toEqual({ ok: false, error: 'this request did not come from an Architect window' })
    expect(jev.state().key.set).toBe(false)

    const results = [
      await call('architect:jev-set-key', trusted, KEY),
      await call('architect:jev-state', trusted, root),
      await call('architect:jev-set', trusted, true, root),
      await call('architect:jev-index', trusted, root),
      await call('architect:jev-same', trusted, root, 'a.ts', 'load'),
      await call('architect:jev-cancel', trusted, root),
      await call('architect:jev-set-key', trusted, `${KEY} spaced`),
      await call('architect:jev-remove-key', trusted),
    ]
    expect(results[0]).toEqual({ ok: true, value: { enabled: false, key: { set: true }, encryption: true, paused: null, budget: { limit: null, tokens: 0, cost: 0 }, run: null, usage: null } })
    expect(results[6]).toEqual({ ok: false, error: 'that does not look like a TypeSafe API key' })
    expect(JSON.stringify(results)).not.toContain(KEY)
    expect([...handlers.keys()].sort()).toEqual(['architect:jev-budget', 'architect:jev-cancel', 'architect:jev-index', 'architect:jev-remove-key', 'architect:jev-same', 'architect:jev-set', 'architect:jev-set-key', 'architect:jev-state'])
  })

  it('trusts the dev server origin or the packaged page and nothing else', () => {
    expect(trustedSender('http://localhost:5173/?root=x', 'http://localhost:5173')).toBe(true)
    expect(trustedSender('http://localhost:5174/', 'http://localhost:5173')).toBe(false)
    expect(trustedSender('file:///app/out/renderer/index.html?root=x', undefined, '/app/out/renderer/index.html')).toBe(true)
    expect(trustedSender('file:///tmp/other.html', undefined, '/app/out/renderer/index.html')).toBe(false)
    expect(trustedSender('', undefined, '/app/out/renderer/index.html')).toBe(false)
  })
})
