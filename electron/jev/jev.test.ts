import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JevProgress } from '../../shared/jev/types'
import { scan } from '../scan/scan'
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

function setup(fetch: typeof globalThis.fetch) {
  const home = temp()
  const root = temp({ 'a.ts': 'export function load(id: string) {\n  return id\n}\n\nexport function fetchIt(id: string) {\n  return id\n}\n' })
  const progress: JevProgress[] = []
  const load = vi.fn(async (at: string) => ({ map: await scan(at), architecture: null }))
  const options: JevOptions = { dir: path.join(home, 'jev'), settings: path.join(home, 'settings.json'), crypt, load, onProgress: (event) => progress.push(event), fetch }
  return { jev: createJev(options), root, home, progress, load }
}

const everyFile = (dir: string): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name)) : []

describe('off path', () => {
  it('makes no network call while off, with or without a key, and says it is disabled', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const { jev, root, load } = setup(fetch)

    expect(jev.state(root)).toEqual({ enabled: false, key: { set: false }, encryption: true, run: null })
    expect(jev.index(root).run).toBeNull()
    expect(await jev.same(root, 'a.ts', 'load')).toEqual({ status: 'disabled', reason: DISABLED })
    expect(await jev.similarBehavior(root, 'a.ts', 'load')).toBe(DISABLED)
    expect(() => jev.setEnabled(true, root)).toThrow(/add a TypeSafe API key/)

    jev.setKey(KEY)
    expect(jev.index(root).run).toBeNull()
    expect(await jev.same(root, 'a.ts', 'load')).toMatchObject({ status: 'disabled' })

    jev.setEnabled(true)
    jev.removeKey()
    expect(jev.index(root).run).toBeNull()
    expect(await jev.similarBehavior(root, 'a.ts', 'load')).toBe(DISABLED)

    expect(fetch).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  })
})

describe('key safety', () => {
  it('never puts the key in a return value, progress event, error, log line or file other than the sealed key', async () => {
    const logged = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}))
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ detail: `rejected ${KEY}` }), { status: 400 }))
    const { jev, root, home, progress } = setup(fetch)

    const returned: unknown[] = [jev.setKey(KEY), jev.setEnabled(true, root)]
    await vi.waitFor(() => expect(progress.at(-1)?.run.status).toBe('done'))
    returned.push(jev.state(root), await jev.same(root, 'a.ts', 'load').catch((err: unknown) => String(err)), await jev.similarBehavior(root, 'a.ts', 'load').catch((err: unknown) => String(err)))

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
    expect(results[0]).toEqual({ ok: true, value: { enabled: false, key: { set: true }, encryption: true, run: null } })
    expect(results[6]).toEqual({ ok: false, error: 'that does not look like a TypeSafe API key' })
    expect(JSON.stringify(results)).not.toContain(KEY)
    expect([...handlers.keys()].sort()).toEqual(['architect:jev-cancel', 'architect:jev-index', 'architect:jev-remove-key', 'architect:jev-same', 'architect:jev-set', 'architect:jev-set-key', 'architect:jev-state'])
  })

  it('trusts the dev server origin or the packaged page and nothing else', () => {
    expect(trustedSender('http://localhost:5173/?root=x', 'http://localhost:5173')).toBe(true)
    expect(trustedSender('http://localhost:5174/', 'http://localhost:5173')).toBe(false)
    expect(trustedSender('file:///app/out/renderer/index.html?root=x', undefined, '/app/out/renderer/index.html')).toBe(true)
    expect(trustedSender('file:///tmp/other.html', undefined, '/app/out/renderer/index.html')).toBe(false)
    expect(trustedSender('', undefined, '/app/out/renderer/index.html')).toBe(false)
  })
})
