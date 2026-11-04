import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { blameFiles } from '.'
import { parseBlame } from './parse'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const ZERO = '0'.repeat(40)
const WIDE = 'c'.repeat(64)

const meta = (time: number, subject: string) =>
  ['author x', `author-time ${time}`, 'committer x', `committer-time ${time}`, `summary ${subject}`, 'filename f.ts']

describe('parseBlame', () => {
  it('maps every final line to its commit and reuses commits seen earlier', () => {
    const out = [
      `${A} 1 1 2`, ...meta(100, 'first commit'), 'boundary', '\tone',
      `${A} 2 2`, '\ttwo',
      `${B} 1 3 1`, ...meta(200, 'second: with colon'), `previous ${A} f.ts`, '\tthree',
      '',
    ].join('\n')
    const lines = parseBlame(out)
    expect(lines).toEqual([
      { at: 100_000, sha: A, subject: 'first commit' },
      { at: 100_000, sha: A, subject: 'first commit' },
      { at: 200_000, sha: B, subject: 'second: with colon' },
    ])
    expect(lines[0]).toBe(lines[1])
  })

  it('marks lines nobody has committed yet', () => {
    const out = [`${A} 1 1 1`, ...meta(100, 'c'), '\tkept', `${ZERO} 2 2 1`, ...meta(999, 'Version of f.ts from f.ts'), '\tnew', ''].join('\n')
    expect(parseBlame(out)).toEqual([{ at: 100_000, sha: A, subject: 'c' }, 'uncommitted'])
  })

  it('reads sha256 repos and content that looks like a header', () => {
    const out = [`${WIDE} 1 1 1`, ...meta(5, 's'), `\t${A} 9 9 9`, `\tsummary fake`, ''].join('\n')
    expect(parseBlame(out)).toEqual([{ at: 5000, sha: WIDE, subject: 's' }])
  })

  it('returns nothing for empty output', () => {
    expect(parseBlame('')).toEqual([])
  })
})

const roots: string[] = []

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
}

function tmp(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'architect-blame-')))
  roots.push(root)
  return root
}

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' })
}

function write(root: string, file: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), text)
}

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
})

describe('blameFiles', () => {
  it('reads committed, edited, untracked, staged and ignored files under a subfolder root', async () => {
    const repo = tmp()
    sh(repo, 'init', '-q')
    write(repo, '.gitignore', 'pkg/gen.ts\n')
    write(repo, 'pkg/old.ts', 'a\nb\n')
    write(repo, 'pkg/edit.ts', 'a\nb\n')
    sh(repo, 'add', '.')
    sh(repo, 'commit', '-qm', 'base')
    write(repo, 'pkg/edit.ts', 'a\nB\n')
    write(repo, 'pkg/new.ts', 'x\n')
    write(repo, 'pkg/staged.ts', 'y\n')
    sh(repo, 'add', 'pkg/staged.ts')
    write(repo, 'pkg/gen.ts', 'z\n')

    const root = path.join(repo, 'pkg')
    const blamed = await blameFiles(root, ['old.ts', 'edit.ts', 'new.ts', 'staged.ts', 'gen.ts', 'gone.ts'])
    expect(blamed.get('old.ts')).toMatchObject([{ subject: 'base' }, { subject: 'base' }])
    expect(blamed.get('edit.ts')).toMatchObject([{ subject: 'base' }, 'uncommitted'])
    expect(blamed.get('new.ts')).toBe('uncommitted')
    expect(blamed.get('staged.ts')).toBe('uncommitted')
    expect(blamed.has('gen.ts')).toBe(false)
    expect(blamed.has('gone.ts')).toBe(false)

    sh(repo, 'checkout', '-q', '--', 'pkg/edit.ts')
    expect((await blameFiles(root, ['edit.ts'])).get('edit.ts')).toMatchObject([{ subject: 'base' }, { subject: 'base' }])

    write(repo, 'pkg/old.ts', 'a\nc\n')
    sh(repo, 'commit', '-qam', 'next')
    expect((await blameFiles(root, ['old.ts'])).get('old.ts')).toMatchObject([{ subject: 'base' }, { subject: 'next' }])
  })

  it('counts every file as uncommitted before the first commit', async () => {
    const repo = tmp()
    sh(repo, 'init', '-q')
    write(repo, 'a.ts', 'a\n')
    expect(await blameFiles(repo, ['a.ts'])).toEqual(new Map([['a.ts', 'uncommitted']]))
  })

  it('returns nothing outside a git repo', async () => {
    const root = tmp()
    write(root, 'a.ts', 'a\n')
    expect((await blameFiles(root, ['a.ts'])).size).toBe(0)
  })

  it('works from a linked worktree and a shallow clone', async () => {
    const repo = tmp()
    sh(repo, 'init', '-q')
    write(repo, 'a.ts', 'a\n')
    sh(repo, 'add', '.')
    sh(repo, 'commit', '-qm', 'one')
    write(repo, 'a.ts', 'a\nb\n')
    sh(repo, 'commit', '-qam', 'two')

    const tree = path.join(tmp(), 'wt')
    sh(repo, 'worktree', 'add', '-q', tree)
    expect((await blameFiles(tree, ['a.ts'])).get('a.ts')).toMatchObject([{ subject: 'one' }, { subject: 'two' }])

    const shallow = path.join(tmp(), 'sh')
    sh(repo, 'clone', '-q', '--depth', '1', `file://${repo}`, shallow)
    expect((await blameFiles(shallow, ['a.ts'])).get('a.ts')).toMatchObject([{ subject: 'two' }, { subject: 'two' }])
  })
})
