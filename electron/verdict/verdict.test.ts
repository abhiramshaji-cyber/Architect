import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from '../contract/graph'
import { changeVerdict, verdictFor } from '.'

const dirs: string[] = []

afterEach(() => {
  while (dirs.length > 0) fs.rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const architecture = parse(['# Demo', '', 'A demo.', '', '## Components', '', '### api', 'Http.', 'owns: `api/**`', '', '### db', 'Data.', 'owns: `db/**`', '', '## Dependencies', '', '- api -> db', '', '## Forbidden', '', '- db -> api : never up', ''].join('\n'))

function tmp(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'architect-verdict-')))
  dirs.push(dir)
  return dir
}

describe('verdictFor', () => {
  it('answers from the drawing, and softens it when architect.md does not parse', () => {
    expect(verdictFor(architecture, null, 'api', 'db')).toEqual({ status: 'allowed' })
    expect(verdictFor(architecture, 'bad line', 'api', 'db')).toMatchObject({ status: 'unknown', reason: expect.stringContaining('bad line') })
    expect(verdictFor(architecture, 'bad line', 'db', 'api')).toMatchObject({ status: 'forbidden', reason: expect.stringMatching(/^never up — the architecture is stale/) })
  })
})

describe('changeVerdict', () => {
  const ask = (root: string, input: { from?: string; to?: string; file?: string; content?: string }, stale: string | null = null) => changeVerdict(tmp(), root, architecture, stale, { id: '1', op: 'check_change', cwd: root, ...input })

  it('answers the edge first, then the rules, then stale', () => {
    const root = tmp()
    const long = `export function go() {\n${'  void 0\n'.repeat(220)}}\n`
    expect(ask(root, { from: 'db', to: 'api', file: 'api/a.ts', content: long })).toMatchObject({ status: 'forbidden' })
    expect(ask(root, { from: 'api', to: 'db', file: 'api/a.ts', content: long })).toMatchObject({ status: 'rule-violation' })
    expect(ask(root, { from: 'api', to: 'db', file: 'api/a.ts', content: 'export const a = 1\n' })).toEqual({ status: 'allowed' })
    expect(ask(root, { file: 'api/a.ts', content: 'export const a = 1\n' })).toEqual({ status: 'allowed' })
    expect(ask(root, { file: 'api/a.ts', content: 'export const a = 1\n' }, 'bad line')).toMatchObject({ status: 'unknown', reason: expect.stringContaining('bad line') })
  })

  it('refuses a half edge and a file without content', () => {
    const root = tmp()
    expect(() => ask(root, { from: 'api' })).toThrow('check_change needs both from and to')
    expect(() => ask(root, { file: 'api/a.ts' })).toThrow('proposed content')
  })
})
