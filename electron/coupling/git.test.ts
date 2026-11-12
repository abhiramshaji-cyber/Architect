import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { scan } from '../scan/scan'
import { couplingOf } from '.'

describe('couplingOf', () => {
  const dirs: string[] = []
  afterAll(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })))
  const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  const temp = () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'architect-coupling-')))
    dirs.push(dir)
    return dir
  }
  const commit = (dir: string, files: string[], message: string) => {
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      fs.appendFileSync(path.join(dir, file), `// ${message}\n`)
    }
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', message)
  }

  it('reads commits under a project that is a folder of the repo, by paths relative to that folder', async () => {
    const dir = temp()
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'config', 'user.email', 't@t')
    git(dir, 'config', 'user.name', 't')
    commit(dir, ['pkg/a.ts', 'pkg/b.ts', 'other/x.ts'], 'one')
    commit(dir, ['pkg/a.ts', 'pkg/b.ts'], 'two')
    const root = path.join(dir, 'pkg')

    const result = await couplingOf(root, await scan(root), [], { minShared: 2, minConfidence: 1 })

    expect(result.ok && result.value.pairs.map((pair) => [pair.files, pair.commits.shared.length, pair.commits.changes])).toEqual([[['a.ts', 'b.ts'], 2, [2, 2]]])
    expect(result.ok && Object.values(result.value.commits).map((c) => c.subject).sort()).toEqual(['one', 'two'])
  })

  it('passes a git failure through instead of guessing', async () => {
    const dir = temp()
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1\n')
    const result = await couplingOf(dir, await scan(dir), [], {})
    expect(result).toMatchObject({ ok: false, error: { kind: 'not-a-repo' } })
  })
})
