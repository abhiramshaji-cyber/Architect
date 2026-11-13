import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JevProgress } from '../../shared/jev/types'
import { scan } from '../scan/scan'
import { createJev } from '.'
import type { Crypt } from './key'
import { CLOSED } from './schedule'

const KEY = 'ts-SENTINEL-key-0123456789'

const crypt: Crypt = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(Buffer.from(text).reverse().toString('base64')),
  decryptString: (data) => Buffer.from(data.toString(), 'base64').reverse().toString(),
}

const dirs: string[] = []

afterEach(() => {
  while (dirs.length > 0) fs.rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const fn = (name: string) => `export function ${name}(id: string) {\n  return id + '${name}'\n}\n`

function temp(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-pause-'))
  dirs.push(dir)
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text)
  return dir
}

const project = (prefix: string) => temp({ 'a.ts': ['one', 'two', 'three', 'four', 'five', 'six'].map((name) => fn(`${prefix}${name}`)).join('\n') })

const sent = (call: Parameters<typeof globalThis.fetch>) => JSON.parse(String(call[1]?.body)) as { state: string; questions: Record<string, { type: string; criteria: Record<string, string> }> }

const named = (call: Parameters<typeof globalThis.fetch>) => {
  const state = JSON.parse(sent(call).state) as { function?: string; first?: { function: string } }
  return state.function ?? state.first?.function ?? ''
}

function ok(call: Parameters<typeof globalThis.fetch>, tokens = 100): Response {
  const answers = Object.fromEntries(Object.entries(sent(call).questions).map(([id, question]) => {
    const labels = Object.keys(question.criteria)
    return [id, question.type === 'noul' ? { type: 'noul', noul: 0.9 } : { type: 'choice', choice: labels[0], probabilities: Object.fromEntries(labels.map((label, i) => [label, i === 0 ? 1 : 0])) }]
  }))
  return new Response(JSON.stringify({ model: 'jev-1', answers, usage: { input_tokens: tokens } }), { status: 200 })
}

const broke = () => new Response(JSON.stringify({ detail: `no credit left for ${KEY}` }), { status: 402 })

function setup(fetch: typeof globalThis.fetch, roots: string[], shown: () => string[] = () => roots) {
  const home = temp()
  const progress: JevProgress[] = []
  const load = async (at: string) => ({ map: await scan(at), architecture: null })
  const options = { dir: path.join(home, 'jev'), settings: path.join(home, 'settings.json'), crypt, load, windows: shown, onProgress: (event: JevProgress) => progress.push(event), fetch }
  const jev = createJev(options)
  jev.setKey(KEY)
  return { jev, home, progress, options }
}

const PAUSED = 'TypeSafe returned 402: the account is out of credit (no credit left for …). Indexing and search are paused until the key is saved again or Retry is pressed on the Jev card in the AI page.'

describe('account errors', () => {
  it('pauses every project on a 402 mid index, stops sending, says why everywhere and never shows the key', async () => {
    const [a, b] = [project('a'), project('b')]
    let calls = 0
    const fetch = vi.fn<typeof globalThis.fetch>(async (...call) => (++calls <= 2 ? ok(call) : broke()))
    const { jev, home, progress } = setup(fetch, [a, b])
    jev.setEnabled(true)
    await vi.waitFor(() => expect(jev.state().paused).toBe(PAUSED))
    await vi.waitFor(() => expect(jev.status(a).index.status).toBe('paused'))

    expect(jev.status(a)).toMatchObject({ paused: PAUSED, index: { status: 'paused', indexed: 2, total: 6, error: PAUSED } })
    expect(jev.status(b)).toMatchObject({ paused: PAUSED, index: { status: 'paused', error: PAUSED } })
    const spent = fetch.mock.calls.length
    expect(spent).toBeLessThanOrEqual(6)

    expect(await jev.same(a, 'a.ts', 'aone')).toEqual({ status: 'paused', reason: PAUSED })
    expect(await jev.similarBehavior(b, 'a.ts', 'bone')).toBe(PAUSED)
    jev.index(a)
    jev.indexOpen()
    jev.windowsChanged()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetch.mock.calls.length).toBe(spent)

    const files = fs.readdirSync(home, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && entry.name !== 'key.bin')
    const seen = [JSON.stringify(progress), JSON.stringify(jev.status(a)), JSON.stringify(jev.state(b)), PAUSED, ...files.map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8'))]
    for (const text of seen) expect(text).not.toContain(KEY)
  })

  it('retries only what failed or was never sent once the user presses Retry, never a cached success', async () => {
    const a = project('a')
    let calls = 0
    const fetch = vi.fn<typeof globalThis.fetch>(async (...call) => (++calls <= 2 ? ok(call) : broke()))
    const { jev } = setup(fetch, [a])
    jev.setEnabled(true)
    await vi.waitFor(() => expect(jev.status(a).index.status).toBe('paused'))
    const answered = fetch.mock.calls.slice(0, 2).map(named)

    fetch.mockClear()
    fetch.mockImplementation(async (...call) => ok(call))
    jev.retry(a)
    expect(jev.state().paused).toBeNull()
    await vi.waitFor(() => expect(jev.status(a).index).toMatchObject({ status: 'done', indexed: 6, total: 6 }))
    expect(fetch.mock.calls.map(named).sort()).toEqual(['aone', 'atwo', 'athree', 'afour', 'afive', 'asix'].filter((name) => !answered.includes(name)).sort())
  })

  it('answers a search with the pause reason when its own confirmations hit a 402, not as a negative result', async () => {
    const a = project('a')
    const fetch = vi.fn<typeof globalThis.fetch>(async (...call) => ok(call))
    const { jev } = setup(fetch, [a])
    jev.setEnabled(true)
    await vi.waitFor(() => expect(jev.status(a).index.status).toBe('done'))
    fetch.mockImplementation(async () => broke())
    const text = await jev.similarBehavior(a, 'a.ts', 'aone')
    expect(text).toBe(PAUSED)
    expect(text).not.toMatch(/confirmations failed|No other function/)
  })
})

describe('one project at a time', () => {
  it('indexes the front project first, queues the rest, pauses one whose window closes and resumes it when it opens again', async () => {
    const [front, back, other] = [project('f'), project('b'), project('o')]
    let shown = [front, back, other]
    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const fetch = vi.fn<typeof globalThis.fetch>(async (...call) => {
      if (named(call).startsWith('b')) await gate
      return ok(call)
    })
    const { jev } = setup(fetch, [], () => shown)
    jev.setEnabled(true)
    await vi.waitFor(() => expect(jev.status(front).index.status).toBe('done'))
    expect(fetch.mock.calls.slice(0, 6).every((call) => named(call).startsWith('f'))).toBe(true)
    await vi.waitFor(() => expect(jev.status(back).index.status).toBe('running'))
    expect(jev.status(other).index.status).toBe('queued')

    shown = [front, other]
    jev.windowsChanged()
    release()
    await vi.waitFor(() => expect(jev.status(back).index).toMatchObject({ status: 'paused', error: CLOSED }))
    await vi.waitFor(() => expect(jev.status(other).index.status).toBe('done'))

    shown = [back, front, other]
    jev.windowsChanged()
    await vi.waitFor(() => expect(jev.status(back).index).toMatchObject({ status: 'done', indexed: 6 }))
  })
})

describe('monthly budget', () => {
  it('is off by default, pauses before a request would pass it and resumes when the budget changes', async () => {
    const a = project('a')
    const fetch = vi.fn<typeof globalThis.fetch>(async (...call) => ok(call, 400))
    const { jev, progress } = setup(fetch, [a])
    expect(jev.state().budget).toEqual({ limit: null, tokens: 0, cost: 0 })
    expect(() => jev.setBudget(-5)).toThrow(/whole number/)
    expect(() => jev.setBudget(1.5)).toThrow(/whole number/)
    jev.setBudget(1000)
    jev.setEnabled(true)
    await vi.waitFor(() => expect(jev.state().paused).toMatch(/^The monthly Jev budget of 1,000 input tokens would be exceeded \(\d+ used this month\)\. Indexing and search are paused until the budget is raised or Retry/))
    await vi.waitFor(() => expect(jev.status(a).index.status).toBe('paused'))
    const spent = fetch.mock.calls.length
    expect(spent).toBeLessThanOrEqual(3)
    expect(jev.state().budget.tokens).toBe(spent * 400)
    expect(jev.state().budget.tokens).toBeLessThanOrEqual(1000)
    expect(progress.at(-1)?.budget.limit).toBe(1000)

    jev.setBudget(null)
    await vi.waitFor(() => expect(jev.status(a).index).toMatchObject({ status: 'done', indexed: 6 }))
    expect(jev.state().paused).toBeNull()
    expect(fetch.mock.calls.length).toBe(6)
  })
})
