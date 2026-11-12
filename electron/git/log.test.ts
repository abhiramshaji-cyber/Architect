import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { commitsSince, countArgs, parseLog, sinceArgs } from './log'

const dirs: string[] = []

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-log-'))
  dirs.push(dir)
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  return dir
}

function commitFile(dir: string, file: string, subject: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  fs.writeFileSync(path.join(dir, file), subject)
  execFileSync('git', ['add', file], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', subject], { cwd: dir })
}

afterAll(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })))

describe('log', () => {
  it('parses commits with no files', () => {
    expect(parseLog('\x1eabc\x1fa\x1f12\x1fmerge')).toEqual([{ sha: 'abc', short: 'a', at: 12_000, subject: 'merge', files: [] }])
  })

  it('reads commits with paths relative to a project inside the repo', async () => {
    const dir = repo()
    commitFile(dir, 'outside.ts', 'outside')
    commitFile(dir, 'app/src/a b.ts', 'first')
    commitFile(dir, 'app/src/a b.ts', 'second\x1fpart')
    const found = await commitsSince(path.join(dir, 'app'), 0)
    expect(found.ok && found.value.map((c) => [c.subject, c.files])).toEqual([
      ['second\x1fpart', ['src/a b.ts']],
      ['first', ['src/a b.ts']],
    ])
  })

  it.each([[0], [-1], [999], [Number.NaN], [Number.POSITIVE_INFINITY]])('reads all of history for a since of %s, never only this second', async (since) => {
    const dir = repo()
    fs.writeFileSync(path.join(dir, 'a.ts'), 'a')
    execFileSync('git', ['add', 'a.ts'], { cwd: dir })
    execFileSync('git', ['commit', '-q', '-m', 'old'], { cwd: dir, env: { ...process.env, GIT_COMMITTER_DATE: '2001-01-01T00:00:00Z' } })
    const found = await commitsSince(dir, since)
    expect(found.ok && found.value.map((c) => c.subject)).toEqual(['old'])
  })

  it('reads only the newest commits up to a limit', async () => {
    const dir = repo()
    commitFile(dir, 'a.ts', 'one')
    commitFile(dir, 'a.ts', 'two')
    commitFile(dir, 'a.ts', 'three')
    const found = await commitsSince(dir, 0, 2)
    expect(found.ok && found.value.map((c) => c.subject)).toEqual(['three', 'two'])
  })

  it.each([[undefined], [0], [-2], [1.5], [Number.NaN], ['3' as unknown as number]])('reads no count limit for %s', (limit) => {
    expect(countArgs(limit)).toEqual([])
  })

  it('passes a since of one second or more to git as a timestamp', () => {
    expect(sinceArgs(1000)).toEqual(['--since=@1'])
    expect(sinceArgs(1_700_000_000_500)).toEqual(['--since=@1700000000'])
  })

  it('returns no commits for an empty repo and fails outside git', async () => {
    expect(await commitsSince(repo(), 0)).toEqual({ ok: true, value: [] })
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-plain-'))
    dirs.push(plain)
    expect((await commitsSince(plain, 0)).ok).toBe(false)
  })
})
