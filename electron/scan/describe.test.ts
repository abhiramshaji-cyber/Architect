import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe as suite, expect, it, vi } from 'vitest'
import type { CodeMap } from '../../shared/types'
import { describe } from './describe'

let root: string
const originalFetch = globalThis.fetch
const originalKey = process.env.ANTHROPIC_API_KEY

const alpha = 'export function alpha() {\n  return 1\n}'
const beta = 'export function beta() {\n  return 2\n}'
const gamma = 'export function gamma() {\n  return 3\n}'

function write(file: string, content: string) {
  fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), content)
}

function map(): CodeMap {
  return {
    root,
    scannedAt: 1,
    folders: [
      {
        path: '',
        folders: ['src'],
        files: [{ path: 'a.ts', functions: [{ name: 'alpha', line: 1, endLine: 1, description: '', calls: [] }] }],
      },
      {
        path: 'src',
        folders: [],
        files: [
          {
            path: 'src/b.ts',
            functions: [
              { name: 'beta', line: 1, endLine: 1, description: '', calls: [] },
              { name: 'gamma', line: 5, endLine: 5, description: '', calls: [] },
            ],
          },
        ],
      },
    ],
  }
}

function descriptions(result: CodeMap) {
  return result.folders.flatMap((f) => f.files.flatMap((file) => file.functions.map((fn) => fn.description)))
}

function reply(sentences: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify(sentences) }] }),
  }
}

function stub(fn: (...args: unknown[]) => unknown) {
  const mock = vi.fn(fn)
  globalThis.fetch = mock as unknown as typeof fetch
  return mock
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'describe-'))
  write('a.ts', alpha)
  write('src/b.ts', `${beta}\n\n${gamma}`)
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalKey
  fs.rmSync(root, { recursive: true, force: true })
})

suite('describe degrades', () => {
  it('never calls the model without an api key', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const fetched = stub(() => {
      throw new Error('should not be called')
    })

    const result = await describe(map(), root)

    expect(fetched).not.toHaveBeenCalled()
    expect(descriptions(result.map)).toEqual(['', '', ''])
    expect(result.map.folders[1]?.files[0]?.functions[1]?.name).toBe('gamma')
  })

  it('survives a rejected request', async () => {
    stub(async () => {
      throw new Error('offline')
    })

    const result = await describe(map(), root)

    expect(descriptions(result.map)).toEqual(['', '', ''])
    expect(result.cache).toEqual({})
  })

  it('survives an http error status', async () => {
    stub(async () => ({ ok: false, status: 500, json: async () => ({}) }))

    const result = await describe(map(), root)

    expect(descriptions(result.map)).toEqual(['', '', ''])
  })

  it('survives a body that is not the expected shape', async () => {
    stub(async () => ({ ok: true, json: async () => 'nonsense' }))

    const result = await describe(map(), root)

    expect(descriptions(result.map)).toEqual(['', '', ''])
  })

  it('survives text that is not json', async () => {
    stub(async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'sorry, no.' }] }) }))

    const result = await describe(map(), root)

    expect(descriptions(result.map)).toEqual(['', '', ''])
  })

  it('survives a body that fails to decode', async () => {
    stub(async () => ({
      ok: true,
      json: async () => {
        throw new Error('bad json')
      },
    }))

    const result = await describe(map(), root)

    expect(descriptions(result.map)).toEqual(['', '', ''])
  })

  it('leaves out files it cannot read', async () => {
    fs.rmSync(path.join(root, 'a.ts'))
    stub(async () => reply({ 'beta:1': 'Gives back the number two.', 'gamma:5': 'Gives back the number three.' }))

    const result = await describe(map(), root)

    expect(descriptions(result.map)).toEqual(['', 'Gives back the number two.', 'Gives back the number three.'])
  })
})

suite('describe validates', () => {
  it('drops names it never asked about', async () => {
    stub(async () => reply({ 'delta:9': 'Unrelated.', 'alpha:1': 42, 'beta:1': 'Gives back the number two.' }))

    const result = await describe(map(), root)

    expect(descriptions(result.map)).toEqual(['', 'Gives back the number two.', ''])
    expect(Object.values(result.cache)).toEqual(['Gives back the number two.'])
  })

  it('keeps a partial answer', async () => {
    stub(async () => reply({ 'alpha:1': 'Hands back the number one.' }))

    const result = await describe(map(), root)

    expect(descriptions(result.map)).toEqual(['Hands back the number one.', '', ''])
  })

  it('keeps descriptions that are already written', async () => {
    const input = map()
    const file = input.folders[0]?.files[0]
    if (file?.functions[0]) file.functions[0].description = 'Already said.'
    const fetched = stub(async () => reply({ 'beta:1': 'Two.', 'gamma:5': 'Three.' }))

    const result = await describe(input, root)

    expect(descriptions(result.map)).toEqual(['Already said.', 'Two.', 'Three.'])
    expect(fetched).toHaveBeenCalledTimes(1)
  })
})

suite('describe identifies each function', () => {
  it('asks separately for two functions declared on one line', async () => {
    write('pair.ts', 'const handlers = { onOpen: () => 1, onClose: () => 2 }\n')
    const input: CodeMap = {
      root,
      scannedAt: 1,
      folders: [
        {
          path: '',
          folders: [],
          files: [
            {
              path: 'pair.ts',
              functions: [
                { name: 'handlers.onOpen', line: 1, endLine: 1, description: '', calls: [] },
                { name: 'handlers.onClose', line: 1, endLine: 1, description: '', calls: [] },
              ],
            },
          ],
        },
      ],
    }

    const fetched = stub(async () =>
      reply({ 'handlers.onOpen:1': 'Reports that the socket opened.', 'handlers.onClose:1': 'Reports that the socket closed.' }),
    )

    const result = await describe(input, root)

    const body = JSON.parse((fetched.mock.calls[0]?.[1] as { body: string }).body)
    const asked = (body.messages[0].content as string).match(/key="[^"]+"/g)
    expect(asked).toEqual(['key="handlers.onOpen:1"', 'key="handlers.onClose:1"'])
    expect(descriptions(result.map)).toEqual(['Reports that the socket opened.', 'Reports that the socket closed.'])
    expect(Object.keys(result.cache)).toHaveLength(2)
  })
})

suite('describe batches and caches', () => {
  it('sends one request per file', async () => {
    const fetched = stub(async () => reply({ 'alpha:1': 'One.', 'beta:1': 'Two.', 'gamma:5': 'Three.' }))

    const result = await describe(map(), root)

    expect(fetched).toHaveBeenCalledTimes(2)
    expect(descriptions(result.map)).toEqual(['One.', 'Two.', 'Three.'])

    const bodies = fetched.mock.calls.map((call) =>
      JSON.parse((call[1] as { body: string }).body).messages[0].content as string,
    )
    expect(bodies.filter((body) => body.includes('a.ts'))).toHaveLength(1)
    expect(bodies.some((body) => body.includes('return 2') && body.includes('return 3'))).toBe(true)
  })

  it('splits a large file across several requests', async () => {
    const lines = Array.from({ length: 200 }, (_, n) => `export function f${n}() { return ${n} }`)
    write('big.ts', lines.join('\n'))

    const input: CodeMap = {
      root,
      scannedAt: 1,
      folders: [
        {
          path: '',
          folders: [],
          files: [
            {
              path: 'big.ts',
              functions: lines.map((_, n) => ({ name: `f${n}`, line: n + 1, endLine: n + 1, description: '', calls: [] })),
            },
          ],
        },
      ],
    }

    const fetched = stub(async (_url: unknown, init: unknown) => {
      const body = JSON.parse((init as { body: string }).body)
      const keys = ((body.messages[0].content as string).match(/key="([^"]+)"/g) ?? []).map((k: string) =>
        k.slice(5, -1),
      )
      return reply(Object.fromEntries(keys.map((k: string) => [k, `Returns ${k}.`])))
    })

    const result = await describe(input, root)

    expect(fetched.mock.calls.length).toBeGreaterThan(1)
    expect(descriptions(result.map).filter((d) => d === '')).toEqual([])
    expect(new Set(descriptions(result.map)).size).toBe(200)
  })

  it('keeps nothing from a truncated response', async () => {
    stub(async () => ({
      ok: true,
      json: async () => ({
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '{"alpha:1": "One."}' }],
      }),
    }))

    const result = await describe(map(), root)

    expect(descriptions(result.map)).toEqual(['', '', ''])
    expect(result.cache).toEqual({})
  })

  it('does not re-describe unchanged source', async () => {
    const first = stub(async () => reply({ 'alpha:1': 'One.', 'beta:1': 'Two.', 'gamma:5': 'Three.' }))
    const described = await describe(map(), root)
    expect(first).toHaveBeenCalledTimes(2)

    const again = stub(() => {
      throw new Error('should not be called')
    })
    const result = await describe(map(), root, described.cache)

    expect(again).not.toHaveBeenCalled()
    expect(descriptions(result.map)).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('re-describes a function whose source changed', async () => {
    stub(async () => reply({ 'alpha:1': 'One.', 'beta:1': 'Two.', 'gamma:5': 'Three.' }))
    const described = await describe(map(), root)

    write('a.ts', 'export function alpha() {\n  return 99\n}')
    const again = stub(async () => reply({ 'alpha:1': 'Hands back ninety nine.' }))
    const result = await describe(map(), root, described.cache)

    expect(again).toHaveBeenCalledTimes(1)
    expect(descriptions(result.map)).toEqual(['Hands back ninety nine.', 'Two.', 'Three.'])
  })

  it('forgets cache entries no longer in the map', async () => {
    stub(async () => reply({ 'alpha:1': 'One.', 'beta:1': 'Two.', 'gamma:5': 'Three.' }))
    const described = await describe(map(), root)

    const shrunk = map()
    shrunk.folders = shrunk.folders.slice(0, 1)
    const result = await describe(shrunk, root, described.cache)

    expect(Object.values(result.cache)).toEqual(['One.'])
  })
})
