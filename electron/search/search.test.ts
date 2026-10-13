import { describe, expect, it } from 'vitest'
import { parseGitGrep, parseRg } from './search'

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

describe('parseGitGrep', () => {
  it('splits on NUL so colons in paths and text survive', () => {
    expect(parseGitGrep('a:b.ts\u00004\u0000x: 1\nbad\n')).toEqual({
      hits: [{ file: 'a:b.ts', line: 4, text: 'x: 1' }],
      capped: false,
    })
  })
})
