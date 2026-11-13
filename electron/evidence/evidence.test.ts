import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { scan } from '../scan/scan'
import { excerptOf } from './excerpt'
import { graphOf } from './graph'
import { evidenceOf } from './index'
import { githubRepo, permalink } from './permalink'

const dirs: string[] = []

const SHA = 'a'.repeat(40)

const SOURCE = [
  'export function load(id: string) {',
  '  return check(id)',
  '}',
  'function check(id: string) {',
  '  return id.length > 0',
  '}',
  'export function main() {',
  '  load("a")',
  '  load("b")',
  '}',
  '',
].join('\n')

function project(files: Record<string, string>, remote?: string, pushed = true): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'architect-evidence-')))
  dirs.push(dir)
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
  }
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  run('init', '-q')
  run('config', 'user.email', 't@t')
  run('config', 'user.name', 't')
  run('add', '.')
  run('commit', '-q', '-m', 'first')
  if (remote !== undefined) run('remote', 'add', 'origin', remote)
  if (remote !== undefined && pushed) run('update-ref', 'refs/remotes/origin/main', 'HEAD')
  return dir
}

const headOf = (dir: string) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir }).toString().trim()

afterAll(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })))

describe('githubRepo', () => {
  it.each([
    ['git@github.com:acme/tool.git', 'acme/tool'],
    ['git@github.com:acme/tool', 'acme/tool'],
    ['https://github.com/acme/tool.git', 'acme/tool'],
    ['https://github.com/acme/tool/', 'acme/tool'],
    ['https://user:secret@github.com/acme/tool.git', 'acme/tool'],
    ['ssh://git@github.com/acme/tool.git', 'acme/tool'],
    ['ssh://git@github.com:22/acme/tool.git', 'acme/tool'],
    ['git://github.com/acme/tool.git', 'acme/tool'],
    ['https://GitHub.com/acme/tool\n', 'acme/tool'],
  ])('reads %s', (remote, expected) => {
    const repo = githubRepo(remote)
    expect(repo && `${repo.owner}/${repo.name}`).toBe(expected)
  })

  it.each(['git@gitlab.com:acme/tool.git', 'https://github.example.com/acme/tool', 'https://github.com/acme', 'https://github.com/acme/tool/tree/main', '/srv/tool.git', '', 'C:\\repos\\tool'])(
    'rejects %s',
    (remote) => expect(githubRepo(remote)).toBeNull(),
  )
})

describe('permalink', () => {
  it('links a range and a single line, encoding each path segment', () => {
    const repo = { owner: 'acme', name: 'tool' }
    expect(permalink(repo, SHA, 'src/a b.ts', 3, 9)).toBe(`https://github.com/acme/tool/blob/${SHA}/src/a%20b.ts#L3-L9`)
    expect(permalink(repo, SHA, 'src/#x.ts', 4, 4)).toBe(`https://github.com/acme/tool/blob/${SHA}/src/%23x.ts#L4`)
  })
})

describe('excerptOf', () => {
  it('numbers the lines and puts each note at the end of its line', () => {
    const text = `a\nb  \n\tc\r\nd\n${'x\n'.repeat(6)}`
    const notes = [
      { line: 2, text: 'first\nnote' },
      { line: 2, text: 'second' },
      { line: 3, text: '   ' },
    ]
    expect(excerptOf(text, { start: 2, end: 10 }, notes)).toBe(
      ['```', ' 2 | b  // <- first note; second', ' 3 | \tc', ' 4 | d', ' 5 | x', ' 6 | x', ' 7 | x', ' 8 | x', ' 9 | x', '10 | x', '```'].join('\n'),
    )
  })

  it('rejects a range past the end and notes outside the range', () => {
    expect(() => excerptOf('a\nb\n', { start: 1, end: 3 })).toThrow('lines 1-3 runs past the end of the file, which has 2 lines')
    expect(() => excerptOf('a\nb', { start: 2, end: 1 })).toThrow('is not a range')
    expect(() => excerptOf('a\nb', { start: 1, end: 1 }, [{ line: 2, text: 'x' }])).toThrow('notes on lines 2 fall outside the excerpt 1-1')
  })
})

describe('graphOf', () => {
  it('draws callers and callees with names and file:line', async () => {
    const dir = project({ 'src/a.ts': SOURCE })
    const map = await scan(dir)
    const graph = graphOf(map, 'src/a.ts', 0, 1)
    expect(graph.callers).toBe(1)
    expect(graph.sites).toEqual([
      { caller: 'main', file: 'src/a.ts', line: 8 },
      { caller: 'main', file: 'src/a.ts', line: 9 },
    ])
    expect(graph.mermaid).toBe(
      ['```mermaid', 'flowchart LR', '  n0(["load<br/>src/a.ts:1"])', '  n1["main<br/>src/a.ts:7"]', '  n2["check<br/>src/a.ts:4"]', '  n1 --> n0', '  n0 --> n2', '```'].join('\n'),
    )
  })

  it('escapes mermaid text in names and paths', async () => {
    const dir = project({ 'src/<q> "1".ts': 'class Queue {\n  #emit() {\n    send()\n  }\n}\nfunction send() {}\n' })
    const graph = graphOf(await scan(dir), 'src/<q> "1".ts', 0, 1)
    expect(graph.mermaid).toContain('n0(["Queue.#35;emit<br/>src/#lt;q#gt; #quot;1#quot;.ts:2"])')
    expect(graph.callers).toBe(0)
  })

  it('walks further out with depth', async () => {
    const dir = project({ 'src/a.ts': SOURCE })
    const graph = graphOf(await scan(dir), 'src/a.ts', 1, 2)
    expect(graph.mermaid).toContain('  n2["main<br/>src/a.ts:7"]\n  n1 --> n0\n  n2 --> n1\n')
    expect(graph.callers).toBe(1)
  })
})

describe('evidenceOf', () => {
  it('returns a permalink, excerpt, call graph and call sites for a symbol', async () => {
    const dir = project({ 'src/a.ts': SOURCE }, 'git@github.com:acme/tool.git')
    const out = await evidenceOf({ cwd: dir, file: 'src/a.ts', symbol: 'load', notes: [{ line: 2, text: 'no cache' }] }, dir, await scan(dir))
    const sha = headOf(dir)
    expect(out).toBe(
      [
        '`load` in `src/a.ts` lines 1-3',
        `https://github.com/acme/tool/blob/${sha}/src/a.ts#L1-L3`,
        ['```', '1 | export function load(id: string) {', '2 |   return check(id)  // <- no cache', '3 | }', '```'].join('\n'),
        ['```mermaid', 'flowchart LR', '  n0(["load<br/>src/a.ts:1"])', '  n1["main<br/>src/a.ts:7"]', '  n2["check<br/>src/a.ts:4"]', '  n1 --> n0', '  n0 --> n2', '```'].join('\n'),
        [
          '1 caller, 2 call sites:',
          `- \`main\` at [src/a.ts:8](https://github.com/acme/tool/blob/${sha}/src/a.ts#L8)`,
          `- \`main\` at [src/a.ts:9](https://github.com/acme/tool/blob/${sha}/src/a.ts#L9)`,
        ].join('\n'),
      ].join('\n\n'),
    )
    expect(out).not.toMatch(/architect/i)
  })

  it('takes a line range and draws the function holding it', async () => {
    const dir = project({ 'src/a.ts': SOURCE }, 'https://github.com/acme/tool')
    const out = await evidenceOf({ cwd: dir, file: 'src/a.ts', lines: { start: 8, end: 8 } }, dir, await scan(dir))
    expect(out).toContain(`/src/a.ts#L8\n`)
    expect(out).toContain('`main` in `src/a.ts` line 8')
    expect(out).toContain('  n0(["main<br/>src/a.ts:7"])')
    expect(out).not.toContain('caller')
  })

  it('says why there is no link instead of emitting one that would 404', async () => {
    const unpushed = project({ 'src/a.ts': SOURCE }, 'git@github.com:acme/tool.git', false)
    const elsewhere = project({ 'src/a.ts': SOURCE }, 'git@gitlab.com:acme/tool.git')
    const local = project({ 'src/a.ts': SOURCE })
    const changed = project({ 'src/a.ts': SOURCE }, 'git@github.com:acme/tool.git')
    fs.appendFileSync(path.join(changed, 'src/a.ts'), '// x\n')
    const input = (dir: string) => ({ cwd: dir, file: 'src/a.ts', lines: { start: 1, end: 2 } })
    const second = async (dir: string) => (await evidenceOf(input(dir), dir, await scan(dir))).split('\n\n')[1]
    expect(await second(unpushed)).toBe('No permalink: HEAD is not on any origin branch, so a link to it would 404. Push first.')
    expect(await second(elsewhere)).toBe('No permalink: the origin remote is not on github.com.')
    expect(await second(local)).toBe('No permalink: the repository has no origin remote.')
    expect(await second(changed)).toBe('No permalink: src/a.ts has uncommitted changes, so its lines at HEAD may differ.')
  })

  it('names the real functions when the symbol is unknown or ambiguous', async () => {
    const dir = project({ 'src/a.ts': SOURCE, 'src/b.ts': 'class A {\n  run() {}\n}\nclass B {\n  run() {}\n}\n' })
    const map = await scan(dir)
    await expect(evidenceOf({ cwd: dir, file: 'src/a.ts', symbol: 'save' }, dir, map)).rejects.toThrow('no function named save in src/a.ts; its functions are load, check, main')
    await expect(evidenceOf({ cwd: dir, file: 'src/b.ts', symbol: 'run' }, dir, map)).rejects.toThrow('run matches 2 functions in src/b.ts, pass the full name: A.run at line 2, B.run at line 5')
    await expect(evidenceOf({ cwd: dir, file: 'src/b.ts', symbol: 'B.run' }, dir, map)).resolves.toContain('`B.run` in `src/b.ts` line 5')
  })

  it('rejects bad input with the reason', async () => {
    const dir = project({ 'src/a.ts': SOURCE })
    const map = await scan(dir)
    await expect(evidenceOf({ cwd: dir, file: 'src/a.ts' }, dir, map)).rejects.toThrow('pass either symbol or lines')
    await expect(evidenceOf({ cwd: dir, file: 'src/nope.ts', symbol: 'load' }, dir, map)).rejects.toThrow('src/nope.ts is not a file')
    await expect(evidenceOf({ cwd: dir, file: 'src/a.ts', lines: { start: 5, end: 40 } }, dir, map)).rejects.toThrow('runs past the end of the file, which has 10 lines')
    await expect(evidenceOf({ cwd: dir, file: 'src/a.ts', symbol: 'load', notes: [{ line: 7, text: 'x' }] }, dir, map)).rejects.toThrow('notes on lines 7 fall outside the excerpt 1-3')
  })
})
