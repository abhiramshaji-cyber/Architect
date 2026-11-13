import { execFile } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { parseGitGrep, parseRg, search } from './search'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

type Done = (error: unknown, stdout: string, stderr: string) => void

const lines = (count: number, row: (n: number) => string) => Array.from({ length: count }, (_, i) => row(i + 1)).join('\n')

function answer(rg: string | null, git: string) {
  vi.mocked(execFile).mockImplementation(((command: string, _args: string[], _options: object, done: Done) => {
    if (command === 'git') done(null, git, '')
    else if (rg === null) done(Object.assign(new Error('spawn rg ENOENT'), { code: 'ENOENT' }), '', '')
    else done(null, rg, '')
  }) as unknown as typeof execFile)
}

const match = (path: object, line: number, lines: object) =>
  JSON.stringify({ type: 'match', data: { path, lines, line_number: line } })

describe('parseRg', () => {
  it('keeps matches, decodes bytes, and skips other events and torn rows', () => {
    const out = [
      JSON.stringify({ type: 'begin', data: { path: { text: './src/a.ts' } } }),
      match({ text: './src/a.ts' }, 3, { text: '  const a = 1\r\n' }),
      match({ bytes: Buffer.from('b.txt').toString('base64') }, 7, { bytes: Buffer.from('hi\n').toString('base64') }),
      '{"type":"match","data":{"pa',
    ].join('\n')

    expect(parseRg(out)).toEqual({
      hits: [
        { file: 'src/a.ts', line: 3, text: '  const a = 1' },
        { file: 'b.txt', line: 7, text: 'hi' },
      ],
      capped: false,
    })
  })

  it('stops at the cap', () => {
    const out = [1, 2, 3].map((n) => match({ text: 'a' }, n, { text: 'x' })).join('\n')
    expect(parseRg(out, 2)).toEqual({ hits: [expect.anything(), expect.anything()], capped: true })
  })
})

describe('search', () => {
  const rg = lines(120, (n) => match({ text: './big.ts' }, n, { text: 'x' })) + '\n' + match({ text: './small.ts' }, 1, { text: 'x' })
  const git = lines(120, (n) => `big.ts\u0000${n}\u0000x`) + '\nsmall.ts\u00001\u0000x\n'

  it.each([
    ['ripgrep', rg],
    ['git grep', null],
  ])('keeps at most 50 hits per file with %s', async (_backend, out) => {
    answer(out, git)
    const found = await search('/repo', 'x')
    expect(found.capped).toBe(false)
    expect(found.hits.filter((hit) => hit.file === 'big.ts')).toHaveLength(50)
    expect(found.hits.filter((hit) => hit.file === 'small.ts')).toHaveLength(1)
  })
})

describe('parseGitGrep', () => {
  it('splits on NUL so colons in paths and text survive', () => {
    expect(parseGitGrep('a:b.ts\u00004\u0000x: 1\nbad\n')).toEqual({
      hits: [{ file: 'a:b.ts', line: 4, text: 'x: 1' }],
      capped: false,
    })
  })
})
