import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { ClaudeWorktree } from '../../shared/types'
import { byRecency, changedPaths, classify, discover, findRepos } from './claude'
import { parseWorktrees } from './git'

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

function tmp(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `architect-${prefix}-`)))
  roots.push(root)
  return root
}

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' })
}

function committed(root: string): string {
  fs.mkdirSync(root, { recursive: true })
  sh(root, 'init', '-b', 'main')
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n')
  sh(root, 'add', 'a.txt')
  sh(root, 'commit', '-m', 'first')
  return root
}

function row(name: string, changedAt: number | null, repo = '/r'): ClaudeWorktree {
  return { repo, name, path: `${repo}/.claude/worktrees/${name}`, branch: name, dirty: false, changedAt, broken: null }
}

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
})

describe('classify', () => {
  const porcelain = [
    'worktree /repo',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    'worktree /repo/.claude/worktrees/with space',
    'HEAD 2222222222222222222222222222222222222222',
    'branch refs/heads/claude/with-space',
    '',
    'worktree /repo/.claude/worktrees/loose',
    'HEAD 3333333333333333333333333333333333333333',
    'detached',
    '',
    'worktree /repo/.claude/worktrees/gone',
    'HEAD 4444444444444444444444444444444444444444',
    'branch refs/heads/gone',
    'prunable gitdir file points to non-existent location',
    '',
    'worktree /elsewhere/side',
    'HEAD 5555555555555555555555555555555555555555',
    'branch refs/heads/side',
    '',
  ].join('\n')

  it('confirms registered worktrees by git, not by folder name', () => {
    const found = [
      { name: 'with space', git: true },
      { name: 'loose', git: true },
    ]

    expect(classify('/repo', found, parseWorktrees(porcelain))).toEqual([
      { repo: '/repo', name: 'with space', path: '/repo/.claude/worktrees/with space', branch: 'claude/with-space', broken: null },
      { repo: '/repo', name: 'loose', path: '/repo/.claude/worktrees/loose', branch: null, broken: null },
      { repo: '/repo', name: 'gone', path: '/repo/.claude/worktrees/gone', branch: 'gone', broken: 'missing' },
    ])
  })

  it('marks folders git does not know about', () => {
    const found = [
      { name: 'plain', git: false },
      { name: 'stray', git: true },
    ]

    expect(classify('/repo', found, []).map((entry) => entry.broken)).toEqual(['not-git', 'unregistered'])
  })

  it('marks every folder when the repo cannot list its worktrees', () => {
    expect(classify('/repo', [{ name: 'a', git: true }], null)).toMatchObject([{ broken: 'unlisted' }])
  })

  it('ignores worktrees outside the claude folder and handles none at all', () => {
    expect(classify('/elsewhere', [], parseWorktrees(porcelain))).toEqual([])
    expect(classify('/repo', [], [])).toEqual([])
  })
})

describe('changedPaths', () => {
  it('reads every kind of status entry, including renames and spaces', () => {
    const stdout = [
      '# branch.oid 1111111111111111111111111111111111111111',
      '# branch.head main',
      '1 .M N... 100644 100644 100644 aaaa bbbb src/a file.ts',
      '2 R. N... 100644 100644 100644 aaaa bbbb R100 new name.ts',
      'old name.ts',
      'u UU N... 100644 100644 100644 100644 aaaa bbbb cccc both.ts',
      '? notes dir/',
      '! ignored.log',
      '',
    ].join('\0')

    expect(changedPaths(stdout)).toEqual(['src/a file.ts', 'new name.ts', 'both.ts', 'notes dir/'])
  })

  it('returns nothing for a clean tree', () => {
    expect(changedPaths('# branch.oid abc\0# branch.head main\0')).toEqual([])
  })
})

describe('byRecency', () => {
  it('puts the most recently changed first and unknown times last, ties by repo then name', () => {
    const rows = [row('old', 1), row('never', null), row('b', 5, '/z'), row('a', 5, '/z'), row('new', 9), row('c', 5, '/a')]

    expect(rows.sort(byRecency).map((entry) => `${entry.repo}:${entry.name}`)).toEqual([
      '/r:new',
      '/a:c',
      '/z:a',
      '/z:b',
      '/r:old',
      '/r:never',
    ])
  })
})

describe('findRepos', () => {
  it('finds claude worktree folders and skips heavy folders and symlink loops', async () => {
    const home = tmp('home')
    fs.mkdirSync(path.join(home, 'code', 'one', '.claude', 'worktrees'), { recursive: true })
    fs.mkdirSync(path.join(home, '.config', 'nvim', '.claude', 'worktrees'), { recursive: true })
    fs.mkdirSync(path.join(home, 'code', 'bare', '.claude'), { recursive: true })
    fs.mkdirSync(path.join(home, 'node_modules', 'dep', '.claude', 'worktrees'), { recursive: true })
    fs.mkdirSync(path.join(home, 'Library', 'x', '.claude', 'worktrees'), { recursive: true })
    fs.symlinkSync(home, path.join(home, 'code', 'loop'))

    expect((await findRepos(home)).sort()).toEqual([path.join(home, '.config', 'nvim'), path.join(home, 'code', 'one')])
  })

  it('stops at the depth bound and survives a missing home', async () => {
    const home = tmp('deep')
    fs.mkdirSync(path.join(home, 'a', 'b', 'c', '.claude', 'worktrees'), { recursive: true })

    expect(await findRepos(home, 2)).toEqual([])
    expect(await findRepos(home, 3)).toEqual([path.join(home, 'a', 'b', 'c')])
    expect(await findRepos(path.join(home, 'nope'))).toEqual([])
  })
})

describe('discover', () => {
  it('lists real, broken and dirty worktrees newest first from a scan', async () => {
    const home = tmp('discover')
    const root = committed(path.join(home, 'Documents', 'my repo'))
    const holder = path.join(root, '.claude', 'worktrees')

    sh(root, 'worktree', 'add', '-b', 'claude/quiet', path.join(holder, 'quiet'))
    sh(root, 'worktree', 'add', '-b', 'claude/busy', path.join(holder, 'busy one'))
    sh(root, 'worktree', 'add', '-b', 'claude/gone', path.join(holder, 'gone'))
    fs.rmSync(path.join(holder, 'gone'), { recursive: true, force: true })
    fs.mkdirSync(path.join(holder, 'plain'))

    fs.writeFileSync(path.join(holder, 'busy one', 'b.txt'), 'new\n')

    const found = await discover([], true, home)

    expect(found.map((entry) => [entry.name, entry.branch, entry.dirty, entry.broken])).toEqual([
      ['busy one', 'claude/busy', true, null],
      ['quiet', 'claude/quiet', false, null],
      ['gone', 'claude/gone', false, 'missing'],
      ['plain', null, false, 'not-git'],
    ])
    expect(found[0]?.changedAt).toBeGreaterThanOrEqual(found[1]?.changedAt ?? Infinity)
  })

  it('refreshes from a known worktree root without scanning and dedupes repos', async () => {
    const home = tmp('known')
    const root = committed(path.join(home, 'repo'))
    const worktree = path.join(root, '.claude', 'worktrees', 'one')
    sh(root, 'worktree', 'add', '-b', 'one', worktree)

    const found = await discover([worktree, root, path.join(home, 'missing')], false, path.join(home, 'unused'))

    expect(found.map((entry) => entry.path)).toEqual([worktree])
  })

  it('returns nothing when there are no worktrees anywhere', async () => {
    expect(await discover([], true, tmp('empty'))).toEqual([])
  })
})
