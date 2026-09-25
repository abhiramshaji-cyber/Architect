import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { ClaudeWorktree } from '../../shared/types'
import { byRecency, changedPaths, classify, discover, findRepos, remove, survey, within } from './claude'
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

function worktree(repo: string, name: string, ...args: string[]): string {
  const target = path.join(repo, '.claude', 'worktrees', name)
  sh(repo, 'worktree', 'add', ...args, target)
  return target
}

function listed(repo: string): string {
  return sh(repo, 'worktree', 'list', '--porcelain')
}

function published(root: string): string {
  const remote = path.join(tmp('remote'), 'origin.git')
  sh(root, 'init', '--bare', '-b', 'main', remote)
  sh(root, 'remote', 'add', 'origin', remote)
  sh(root, 'push', '-q', 'origin', 'main')
  sh(root, 'remote', 'set-head', 'origin', 'main')
  return root
}

const KEEP = { force: false, branch: false }
const NO_TRASH = async (): Promise<void> => {
  throw new Error('trash must not be used')
}

describe('within', () => {
  it('treats the folder and anything under it as inside, and siblings as outside', () => {
    expect(within('/r/.claude/worktrees/a', '/r/.claude/worktrees/a')).toBe(true)
    expect(within('/r/.claude/worktrees/a/src', '/r/.claude/worktrees/a')).toBe(true)
    expect(within('/r/.claude/worktrees/ab', '/r/.claude/worktrees/a')).toBe(false)
    expect(within('/r/.claude/worktrees/..a', '/r/.claude/worktrees/a')).toBe(false)
    expect(within('/r', '/r/.claude/worktrees/a')).toBe(false)
  })
})

describe('remove', () => {
  it('removes a clean worktree with git and keeps its branch', async () => {
    const repo = committed(tmp('rm-clean'))
    const target = worktree(repo, 'clean', '-b', 'claude/clean')

    expect(await survey(repo, target, [])).toEqual({
      ok: true,
      value: { kind: 'remove', dirty: 0, unpushed: 0, branch: 'claude/clean', base: 'main', merged: true },
    })
    expect(await remove(repo, target, KEEP, [], NO_TRASH)).toEqual({
      ok: true,
      value: { how: 'remove', branch: null, branchError: null },
    })
    expect(fs.existsSync(target)).toBe(false)
    expect(listed(repo)).not.toContain(target)
    expect(sh(repo, 'branch', '--list', 'claude/clean')).toContain('claude/clean')
  })

  it('deletes a merged branch with branch -d only when asked', async () => {
    const repo = committed(tmp('rm-branch'))
    const target = worktree(repo, 'merged', '-b', 'claude/merged')

    expect(await remove(repo, target, { force: false, branch: true }, [], NO_TRASH)).toEqual({
      ok: true,
      value: { how: 'remove', branch: 'claude/merged', branchError: null },
    })
    expect(sh(repo, 'branch', '--list', 'claude/merged')).toBe('')
  })

  it('refuses a dirty worktree without force, then removes it with force', async () => {
    const repo = committed(tmp('rm-dirty'))
    const target = worktree(repo, 'dirty', '-b', 'claude/dirty')
    fs.writeFileSync(path.join(target, 'a.txt'), 'changed\n')
    fs.writeFileSync(path.join(target, 'new.txt'), 'new\n')

    const surveyed = await survey(repo, target, [])
    expect(surveyed.ok && surveyed.value.kind === 'remove' && surveyed.value.dirty).toBe(2)

    const refused = await remove(repo, target, KEEP, [], NO_TRASH)
    expect(refused.ok).toBe(false)
    if (refused.ok || refused.error.kind !== 'git') throw new Error('expected a git failure')
    expect(refused.error.left).toBe('both')
    expect(refused.error.error.kind === 'failed' && refused.error.error.stderr).toMatch(/--force/)
    expect(fs.readFileSync(path.join(target, 'new.txt'), 'utf8')).toBe('new\n')

    expect((await remove(repo, target, { force: true, branch: false }, [], NO_TRASH)).ok).toBe(true)
    expect(fs.existsSync(target)).toBe(false)
  })

  it('counts commits on no remote and not in the default branch, and keeps that branch even when asked', async () => {
    const repo = published(committed(tmp('rm-unpushed')))
    const target = worktree(repo, 'ahead', '-b', 'claude/ahead')
    fs.writeFileSync(path.join(target, 'b.txt'), 'two\n')
    sh(target, 'add', 'b.txt')
    sh(target, 'commit', '-m', 'second')

    expect(await survey(repo, target, [])).toEqual({
      ok: true,
      value: { kind: 'remove', dirty: 0, unpushed: 1, branch: 'claude/ahead', base: 'origin/main', merged: false },
    })

    sh(target, 'push', '-q', 'origin', 'claude/ahead')
    const pushed = await survey(repo, target, [])
    expect(pushed.ok && pushed.value.kind === 'remove' && [pushed.value.unpushed, pushed.value.merged]).toEqual([0, false])

    expect(await remove(repo, target, { force: false, branch: true }, [], NO_TRASH)).toEqual({
      ok: true,
      value: { how: 'remove', branch: null, branchError: null },
    })
    expect(sh(repo, 'branch', '--list', 'claude/ahead')).toContain('claude/ahead')
  })

  it('counts commits on a detached head that no branch or remote holds', async () => {
    const repo = published(committed(tmp('rm-detached')))
    const target = worktree(repo, 'loose', '--detach')
    fs.writeFileSync(path.join(target, 'b.txt'), 'two\n')
    sh(target, 'add', 'b.txt')
    sh(target, 'commit', '-m', 'loose')

    expect(await survey(repo, target, [])).toEqual({
      ok: true,
      value: { kind: 'remove', dirty: 0, unpushed: 1, branch: null, base: 'origin/main', merged: false },
    })
  })

  it('shows git refusing a locked worktree and leaves it in place', async () => {
    const repo = committed(tmp('rm-locked'))
    const target = worktree(repo, 'locked', '-b', 'claude/locked')
    sh(repo, 'worktree', 'lock', target)

    const refused = await remove(repo, target, { force: true, branch: false }, [], NO_TRASH)
    if (refused.ok || refused.error.kind !== 'git') throw new Error('expected a git failure')
    expect(refused.error.left).toBe('both')
    expect(refused.error.error.kind === 'failed' && refused.error.error.stderr).toMatch(/locked/)
    expect(fs.existsSync(target)).toBe(true)
  })

  it('prunes a registered worktree whose folder is gone', async () => {
    const repo = committed(tmp('rm-missing'))
    const target = worktree(repo, 'gone', '-b', 'claude/gone')
    fs.rmSync(target, { recursive: true, force: true })

    expect(await survey(repo, target, [])).toEqual({ ok: true, value: { kind: 'prune' } })
    expect(await remove(repo, target, KEEP, [], NO_TRASH)).toEqual({
      ok: true,
      value: { how: 'prune', branch: null, branchError: null },
    })
    expect(listed(repo)).not.toContain(target)
  })

  it('reports a locked missing worktree that prune leaves registered', async () => {
    const repo = committed(tmp('rm-missing-locked'))
    const target = worktree(repo, 'gone', '-b', 'claude/gone')
    sh(repo, 'worktree', 'lock', target)
    fs.rmSync(target, { recursive: true, force: true })

    expect(await remove(repo, target, KEEP, [], NO_TRASH)).toEqual({
      ok: false,
      error: { kind: 'git', error: { kind: 'locked-worktree', path: target }, left: 'registration' },
    })
  })

  it('moves a plain folder git does not know to the trash, and reports a trash failure', async () => {
    const repo = committed(tmp('rm-plain'))
    const target = path.join(repo, '.claude', 'worktrees', 'plain')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, 'notes.txt'), 'x\n')
    const trashed: string[] = []

    expect(await survey(repo, target, [])).toEqual({ ok: true, value: { kind: 'trash' } })
    expect(
      await remove(repo, target, KEEP, [], async (item) => {
        trashed.push(item)
      }),
    ).toEqual({ ok: true, value: { how: 'trash', branch: null, branchError: null } })
    expect(trashed).toEqual([target])

    expect(
      await remove(repo, target, KEEP, [], async () => {
        throw new Error('Operation not permitted')
      }),
    ).toEqual({ ok: false, error: { kind: 'trash-failed', path: target, message: 'Operation not permitted' } })
    expect(fs.existsSync(path.join(target, 'notes.txt'))).toBe(true)
  })

  it('leaves a folder with its own git alone when the repo does not list it', async () => {
    const repo = committed(tmp('rm-unregistered'))
    const target = committed(path.join(repo, '.claude', 'worktrees', 'clone'))

    expect(await remove(repo, target, KEEP, [], NO_TRASH)).toEqual({
      ok: false,
      error: { kind: 'unregistered', path: target, repo },
    })
    expect(fs.existsSync(path.join(target, 'a.txt'))).toBe(true)
  })

  it('refuses a worktree open in any window, including a folder inside it', async () => {
    const repo = committed(tmp('rm-open'))
    const target = worktree(repo, 'open', '-b', 'claude/open')
    fs.mkdirSync(path.join(target, 'src'))

    for (const open of [[target], ['/elsewhere', path.join(target, 'src')]]) {
      expect(await remove(repo, target, KEEP, open, NO_TRASH)).toEqual({ ok: false, error: { kind: 'open', path: target } })
    }
    expect(fs.existsSync(target)).toBe(true)
    expect((await survey(repo, target, [repo])).ok).toBe(true)
  })

  it('refuses anything that is not directly inside the claude worktrees folder', async () => {
    const repo = committed(tmp('rm-outside'))
    const holder = path.join(repo, '.claude', 'worktrees')
    fs.mkdirSync(holder, { recursive: true })
    const elsewhere = tmp('rm-elsewhere')
    fs.symlinkSync(elsewhere, path.join(holder, 'link'))
    fs.writeFileSync(path.join(holder, 'file'), 'x\n')

    for (const target of [repo, holder, path.join(holder, 'link'), path.join(holder, 'file'), path.join(holder, 'a', 'b'), elsewhere]) {
      const refused = await remove(repo, target, KEEP, [], NO_TRASH)
      expect(refused.ok ? null : refused.error.kind).toBe('outside')
    }
    expect(fs.existsSync(elsewhere)).toBe(true)
  })

  it('reports a worktree that is already gone and a repo git cannot read', async () => {
    const repo = committed(tmp('rm-nothing'))
    const target = path.join(repo, '.claude', 'worktrees', 'never')
    expect(await remove(repo, target, KEEP, [], NO_TRASH)).toEqual({
      ok: false,
      error: { kind: 'git', error: { kind: 'no-worktree', path: target }, left: 'neither' },
    })

    const bare = tmp('rm-not-repo')
    const inside = path.join(bare, '.claude', 'worktrees', 'x')
    fs.mkdirSync(inside, { recursive: true })
    const refused = await remove(bare, inside, KEEP, [], NO_TRASH)
    expect(refused.ok ? null : refused.error.kind === 'git' && refused.error.error.kind).toBe('not-a-repo')
  })
})
