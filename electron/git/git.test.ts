import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createBranch, createWorktree, defaultBranch, fileAtRef, head, parseStatus, parseWorktrees, status, unquotePath, worktrees } from './git'

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

function repo(prefix = 'git'): string {
  const root = tmp(prefix)
  sh(root, 'init', '-b', 'main')
  return root
}

function committed(prefix = 'git'): string {
  const root = repo(prefix)
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n')
  sh(root, 'add', 'a.txt')
  sh(root, 'commit', '-m', 'first')
  return root
}

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
})

describe('status', () => {
  it('reports the branch and a clean tree', async () => {
    const out = await status(committed())

    expect(out).toMatchObject({ ok: true, value: { head: { kind: 'branch', branch: 'main' }, dirty: false, ahead: 0, behind: 0 } })
  })

  it('counts staged, unstaged and untracked changes', async () => {
    const root = committed()
    fs.writeFileSync(path.join(root, 'a.txt'), 'two\n')
    fs.writeFileSync(path.join(root, 'b.txt'), 'new\n')
    fs.writeFileSync(path.join(root, 'c.txt'), 'staged\n')
    sh(root, 'add', 'c.txt')

    const out = await status(root)

    expect(out.ok && out.value).toMatchObject({ dirty: true, staged: 1, unstaged: 1, untracked: 1, conflicted: 0 })
  })

  it('reports an unborn branch with no commit', async () => {
    const out = await head(repo())

    expect(out).toEqual({ ok: true, value: { kind: 'branch', branch: 'main', commit: null } })
  })

  it('reports a detached head', async () => {
    const root = committed()
    sh(root, 'checkout', '--detach', 'HEAD')

    const out = await head(root)

    expect(out.ok && out.value.kind).toBe('detached')
    expect(out.ok && out.value.kind === 'detached' && out.value.commit).toMatch(/^[0-9a-f]{40}$/)
  })

  it('counts commits ahead of the upstream', async () => {
    const origin = tmp('origin')
    sh(origin, 'init', '--bare', '-b', 'main')
    const source = committed()
    sh(source, 'remote', 'add', 'origin', origin)
    sh(source, 'push', '-u', 'origin', 'main')
    fs.writeFileSync(path.join(source, 'a.txt'), 'two\n')
    sh(source, 'commit', '-am', 'second')

    const out = await status(source)

    expect(out.ok && out.value).toMatchObject({ upstream: 'origin/main', ahead: 1, behind: 0 })
  })
})

describe('failures', () => {
  it('reports a directory that is not a repo', async () => {
    const root = tmp('plain')

    expect(await status(root)).toEqual({ ok: false, error: { kind: 'not-a-repo', root } })
  })

  it('reports a root that does not exist', async () => {
    const root = path.join(tmp('gone'), 'missing')

    expect(await status(root)).toEqual({ ok: false, error: { kind: 'missing-root', root } })
  })

  it('reports git not being installed', async () => {
    const root = committed()
    const original = process.env.PATH
    process.env.PATH = path.join(root, 'no-binaries-here')

    try {
      expect(await status(root)).toEqual({ ok: false, error: { kind: 'not-installed' } })
    } finally {
      process.env.PATH = original
    }
  })

  it('reports a repo with no commits when a command needs one', async () => {
    const root = repo()

    expect(await fileAtRef(root, 'HEAD', 'a.txt')).toEqual({ ok: false, error: { kind: 'no-commits', root } })
  })

  it('reports a failing command with its stderr', async () => {
    const root = committed()

    const out = await fileAtRef(root, 'HEAD', 'nope.txt')

    expect(out).toEqual({ ok: false, error: { kind: 'not-in-ref', ref: 'HEAD', file: 'nope.txt' } })
  })
})

describe('fileAtRef', () => {
  it('returns the content at a ref', async () => {
    const root = committed()
    fs.writeFileSync(path.join(root, 'a.txt'), 'two\n')

    expect(await fileAtRef(root, 'HEAD', 'a.txt')).toEqual({ ok: true, value: 'one\n' })
  })

  it('rejects a ref that does not resolve', async () => {
    const out = await fileAtRef(committed(), 'nosuchref', 'a.txt')

    expect(out).toEqual({ ok: false, error: { kind: 'bad-ref', ref: 'nosuchref' } })
  })

  it('rejects an argument that would read as an option', async () => {
    const out = await fileAtRef(committed(), '--upload-pack=touch', 'a.txt')

    expect(out).toEqual({ ok: false, error: { kind: 'bad-argument', value: '--upload-pack=touch' } })
  })
})

describe('worktrees', () => {
  it('lists the main worktree and one whose path contains spaces', async () => {
    const root = committed()
    const extra = path.join(tmp('wt'), 'a worktree dir')
    sh(root, 'worktree', 'add', '-b', 'side', extra)

    const out = await worktrees(root)
    if (!out.ok) throw new Error(out.error.kind)

    expect(out.value.map((w) => w.path)).toEqual([root, extra])
    expect(out.value[1]).toMatchObject({ branch: 'side', detached: false, exists: true })
  })

  it('marks a worktree whose directory is gone as missing', async () => {
    const root = committed()
    const extra = path.join(tmp('wt'), 'removed')
    sh(root, 'worktree', 'add', '-b', 'side', extra)
    fs.rmSync(extra, { recursive: true, force: true })

    const out = await worktrees(root)

    expect(out.ok && out.value.find((w) => w.path === extra)).toMatchObject({ exists: false })
  })
})

describe('defaultBranch', () => {
  it('reads the remote head of a clone', async () => {
    const origin = tmp('origin')
    sh(origin, 'init', '--bare', '-b', 'trunk')
    const source = committed()
    sh(source, 'branch', '-m', 'trunk')
    sh(source, 'remote', 'add', 'origin', origin)
    sh(source, 'push', '-u', 'origin', 'trunk')
    const clone = tmp('clone')
    sh(clone, 'clone', origin, 'work')

    expect(await defaultBranch(path.join(clone, 'work'))).toEqual({ ok: true, value: { remote: 'origin', branch: 'trunk' } })
  })

  it('reports a repo with no remote', async () => {
    const root = committed()

    expect(await defaultBranch(root)).toEqual({ ok: false, error: { kind: 'no-remote', root } })
  })

  it('reports a remote whose head is unknown', async () => {
    const root = committed()
    sh(root, 'remote', 'add', 'origin', tmp('bare'))

    expect(await defaultBranch(root)).toEqual({ ok: false, error: { kind: 'no-default-branch', remote: 'origin' } })
  })
})

function cloned(): string {
  const origin = tmp('origin')
  sh(origin, 'init', '--bare', '-b', 'main')
  const source = committed()
  sh(source, 'remote', 'add', 'origin', origin)
  sh(source, 'push', '-u', 'origin', 'main')
  const clone = path.join(tmp('clone'), 'work')
  sh(path.dirname(clone), 'clone', origin, 'work')
  return clone
}

describe('createBranch', () => {
  it('branches from the fetched default branch, not HEAD', async () => {
    const clone = cloned()
    sh(clone, 'checkout', '-b', 'stale')

    const out = await createBranch(clone, 'feature')

    expect(out).toEqual({ ok: true, value: { branch: 'feature', base: 'origin/main' } })
    expect(await head(clone)).toEqual({ ok: true, value: { kind: 'branch', branch: 'feature', commit: expect.any(String) } })
  })

  it('refuses a branch name that already exists', async () => {
    const clone = cloned()
    sh(clone, 'branch', 'feature')

    expect(await createBranch(clone, 'feature')).toEqual({ ok: false, error: { kind: 'branch-exists', name: 'feature' } })
  })

  it('reports a repo with no remote', async () => {
    const root = committed()

    expect(await createBranch(root, 'feature')).toEqual({ ok: false, error: { kind: 'no-remote', root } })
  })

  it('rejects an invalid branch name', async () => {
    const clone = cloned()

    expect(await createBranch(clone, 'bad..name')).toEqual({ ok: false, error: { kind: 'invalid-branch', name: 'bad..name' } })
  })

  it('rejects a name that would read as an option', async () => {
    const clone = cloned()

    expect(await createBranch(clone, '--force')).toEqual({ ok: false, error: { kind: 'bad-argument', value: '--force' } })
  })

  it('refuses to switch a dirty working tree', async () => {
    const clone = cloned()
    fs.writeFileSync(path.join(clone, 'a.txt'), 'changed\n')

    expect(await createBranch(clone, 'feature')).toEqual({ ok: false, error: { kind: 'dirty', root: clone } })
  })
})

describe('createWorktree', () => {
  it('adds a worktree branched from the fetched default branch', async () => {
    const clone = cloned()
    const target = path.join(tmp('wt'), 'feature')

    const out = await createWorktree(clone, target, 'feature')

    expect(out).toEqual({ ok: true, value: { path: target, branch: 'feature', base: 'origin/main' } })
    expect(await head(target)).toEqual({ ok: true, value: { kind: 'branch', branch: 'feature', commit: expect.any(String) } })
    expect(await head(clone)).toEqual({ ok: true, value: { kind: 'branch', branch: 'main', commit: expect.any(String) } })
  })

  it('refuses a worktree path that already exists', async () => {
    const clone = cloned()
    const target = tmp('taken')

    expect(await createWorktree(clone, target, 'feature')).toEqual({ ok: false, error: { kind: 'worktree-exists', path: target } })
  })

  it('refuses a branch name that already exists', async () => {
    const clone = cloned()
    sh(clone, 'branch', 'feature')
    const target = path.join(tmp('wt'), 'feature')

    expect(await createWorktree(clone, target, 'feature')).toEqual({ ok: false, error: { kind: 'branch-exists', name: 'feature' } })
  })

  it('reports a repo with no remote', async () => {
    const root = committed()
    const target = path.join(tmp('wt'), 'feature')

    expect(await createWorktree(root, target, 'feature')).toEqual({ ok: false, error: { kind: 'no-remote', root } })
  })
})

describe('parseWorktrees', () => {
  it('parses records, not lines of prose', () => {
    const fixture = [
      'worktree /home/u/repo',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /home/u/a worktree dir',
      'HEAD 2222222222222222222222222222222222222222',
      'detached',
      '',
      'worktree /home/u/locked',
      'HEAD 3333333333333333333333333333333333333333',
      'branch refs/heads/feat/x',
      'locked hands off',
      'prunable gitdir file points to non-existent location',
      '',
      'worktree /home/u/bare',
      'bare',
      '',
    ].join('\n')

    expect(parseWorktrees(fixture)).toEqual([
      { path: '/home/u/repo', head: '1'.repeat(40), branch: 'main', detached: false, bare: false, locked: false, prunable: false },
      { path: '/home/u/a worktree dir', head: '2'.repeat(40), branch: null, detached: true, bare: false, locked: false, prunable: false },
      { path: '/home/u/locked', head: '3'.repeat(40), branch: 'feat/x', detached: false, bare: false, locked: true, prunable: true },
      { path: '/home/u/bare', head: null, branch: null, detached: false, bare: true, locked: false, prunable: false },
    ])
  })

  it('unquotes a path git had to escape', () => {
    expect(unquotePath('"/home/u/a\\nb"')).toBe('/home/u/a\nb')
    expect(unquotePath('"/home/u/caf\\303\\251"')).toBe('/home/u/café')
    expect(unquotePath('/home/u/plain')).toBe('/home/u/plain')
  })
})

describe('parseStatus', () => {
  it('consumes the second path of a rename record', () => {
    const fixture = [
      '# branch.oid 4444444444444444444444444444444444444444',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -3',
      '2 R. N... 100644 100644 100644 4444 4444 R100 new.txt',
      'old.txt',
      '1 .M N... 100644 100644 100644 4444 4444 a.txt',
      'u UU N... 100644 100644 100644 100644 4444 4444 4444 conflict.txt',
      '? untracked.txt',
      '',
    ].join('\0')

    expect(parseStatus(fixture)).toEqual({
      head: { kind: 'branch', branch: 'main', commit: '4'.repeat(40) },
      upstream: 'origin/main',
      ahead: 2,
      behind: 3,
      staged: 1,
      unstaged: 1,
      untracked: 1,
      conflicted: 1,
      dirty: true,
    })
  })

  it('reads a detached head out of the branch header', () => {
    const fixture = ['# branch.oid 5555555555555555555555555555555555555555', '# branch.head (detached)', ''].join('\0')

    expect(parseStatus(fixture).head).toEqual({ kind: 'detached', commit: '5'.repeat(40) })
  })
})
