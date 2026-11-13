import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'
import { readHistory } from '.'
import { streamLines } from './stream'

vi.mock('./stream', () => ({ streamLines: vi.fn(async () => false) }))

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'architect-churn-fail-')))
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

it('flags a read whose patch pass failed and reads again next time instead of caching it', async () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  fs.writeFileSync(path.join(dir, 'a.ts'), 'a\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'first')

  const first = await readHistory(dir, 0)
  const calls = vi.mocked(streamLines).mock.calls.length
  const second = await readHistory(dir, 0)

  expect(first.complete).toBe(false)
  expect(first.commits[0]?.files[0]).toMatchObject({ path: 'a.ts', added: 1, hunks: null })
  expect(second.complete).toBe(false)
  expect(vi.mocked(streamLines).mock.calls.length).toBe(calls * 2)
})

it('loses only the file whose patch section cannot be read, not the rest of its commit', async () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  fs.writeFileSync(path.join(dir, 'b.ts'), 'b\n')
  fs.writeFileSync(path.join(dir, 'c.ts'), 'c\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'second')
  const sha = git('rev-parse', 'HEAD').trim()
  vi.mocked(streamLines).mockImplementation(async (_root, args, onLine) => {
    const lines =
      args[0] === 'log' ? [`\x1e${sha}\x1f0`, 'diff --git "a/c\\q.ts" "b/c\\q.ts"', 'new file mode 100644', '@@ -0,0 +1 @@', '+c', 'diff --git a/b.ts b/b.ts', 'new file mode 100644', '@@ -0,0 +1 @@', '+b'] : []
    lines.forEach(onLine)
    return true
  })

  const history = await readHistory(dir, 0)

  expect(history.complete).toBe(false)
  expect(history.commits[0]?.files).toEqual([
    { path: 'b.ts', added: 1, removed: 0, binary: false, created: true, deleted: false, hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 1 }] },
    { path: 'c.ts', added: 1, removed: 0, binary: false, created: false, deleted: false, hunks: null },
  ])
})
