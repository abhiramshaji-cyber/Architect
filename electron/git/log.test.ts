import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { commitsSince, parseLog } from './log'

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

  it('returns no commits for an empty repo and fails outside git', async () => {
    expect(await commitsSince(repo(), 0)).toEqual({ ok: true, value: [] })
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-plain-'))
    dirs.push(plain)
    expect((await commitsSince(plain, 0)).ok).toBe(false)
  })
})
