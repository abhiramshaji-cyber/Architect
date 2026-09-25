import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { clean, clonePath, create, keep, plan, repoKey, risk, slug, worktreePath } from './open'

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

function identify(root: string): void {
  sh(root, 'config', 'user.name', 'Test')
  sh(root, 'config', 'user.email', 'test@example.com')
}

function write(root: string, file: string, body: string): void {
  fs.writeFileSync(path.join(root, file), body)
}

function commit(root: string, file: string, body: string, message: string): void {
  write(root, file, body)
  sh(root, 'add', file)
  sh(root, 'commit', '-m', message)
}

function origin(owner: string, name: string): string {
  const home = tmp('origin')
  const bare = path.join(home, owner, `${name}.git`)
  fs.mkdirSync(path.dirname(bare), { recursive: true })
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { env: ENV })

  const seed = tmp('seed')
  sh(seed, 'init', '-b', 'main')
  identify(seed)
  commit(seed, 'a.txt', 'one\n', 'first')
  sh(seed, 'checkout', '-b', 'feature')
  commit(seed, 'b.txt', 'branch\n', 'feature work')
  sh(seed, 'checkout', 'main')
  sh(seed, 'remote', 'add', 'origin', bare)
  sh(seed, 'push', 'origin', 'main', 'feature')

  return bare
}

function cloned(dir: string, name: string, bare: string): string {
  const target = path.join(dir, name)
  execFileSync('git', ['clone', bare, target], { env: ENV })
  identify(target)
  return target
}

function pushed(bare: string, branch: string, file: string, body: string): void {
  const side = tmp('side')
  execFileSync('git', ['clone', '-b', branch, bare, side], { env: ENV })
  identify(side)
  commit(side, file, body, 'remote work')
  sh(side, 'push', 'origin', branch)
}

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
})

describe('paths', () => {
  it('reads owner and name out of any remote url shape', () => {
    expect(repoKey('git@github.com:Octo/Hello.git')).toBe('octo/hello')
    expect(repoKey('https://github.com/Octo/Hello')).toBe('octo/hello')
    expect(repoKey('nonsense')).toBe(null)
  })

  it('flattens the characters a branch name may hold and a directory may not', () => {
    expect(slug('feat/repo picker')).toBe('feat-repo-picker')
    expect(slug('fix\\#12')).toBe('fix--12')
  })

  it('places a worktree beside the clone, by branch or by pull request', () => {
    expect(worktreePath('/repos/hello', 'feat/x')).toBe('/repos/hello-feat-x')
    expect(worktreePath('/repos/hello', 'feat/x', 12)).toBe('/repos/hello-pr-12')
  })
})

describe('clonePath', () => {
  it('takes the flat directory when nothing is there', async () => {
    const dir = tmp('dir')

    expect(await clonePath(dir, 'octocat/hello')).toBe(path.join(dir, 'hello'))
  })

  it('reuses a directory that already serves the repo', async () => {
    const dir = tmp('dir')
    const bare = origin('octocat', 'hello')
    cloned(dir, 'hello', bare)

    expect(await clonePath(dir, 'octocat/hello')).toBe(path.join(dir, 'hello'))
  })

  it('falls back to the owner scoped directory when the flat one holds a different repo', async () => {
    const dir = tmp('dir')
    cloned(dir, 'hello', origin('someone', 'hello'))

    expect(await clonePath(dir, 'octocat/hello')).toBe(path.join(dir, 'octocat-hello'))
  })

  it('refuses when every candidate directory is taken by another repo', async () => {
    const dir = tmp('dir')
    cloned(dir, 'hello', origin('someone', 'hello'))
    const other = cloned(tmp('other'), 'hello', origin('third', 'hello'))
    fs.renameSync(other, path.join(dir, 'octocat-hello'))

    expect(await clonePath(dir, 'octocat/hello')).toBe(null)
  })

  it('refuses a name that is not owner and repo', async () => {
    expect(await clonePath(tmp('dir'), 'hello')).toBe(null)
  })
})

describe('plan', () => {
  it('asks for a clone when the repo has never been on disk', async () => {
    const dir = tmp('dir')
    const out = await plan(dir, 'octocat/hello', 'main')

    expect(out).toEqual({
      ok: true,
      value: { kind: 'clone', basePath: path.join(dir, 'hello'), worktreePath: path.join(dir, 'hello-main') },
    })
  })

  it('asks for a fresh worktree when the clone exists without one for the branch', async () => {
    const dir = tmp('dir')
    cloned(dir, 'hello', origin('octocat', 'hello'))
    const out = await plan(dir, 'octocat/hello', 'feature')

    expect(out).toMatchObject({ ok: true, value: { kind: 'fresh', worktreePath: path.join(dir, 'hello-feature') } })
  })

  it('reports the main clone itself as the checkout holding the branch', async () => {
    const dir = tmp('dir')
    const base = cloned(dir, 'hello', origin('octocat', 'hello'))
    const out = await plan(dir, 'octocat/hello', 'main')

    expect(out).toMatchObject({ ok: true, value: { kind: 'existing', existing: base, basePath: base } })
  })

  it('counts uncommitted files and unpushed commits separately', async () => {
    const dir = tmp('dir')
    const base = cloned(dir, 'hello', origin('octocat', 'hello'))
    commit(base, 'c.txt', 'mine\n', 'local only')
    write(base, 'a.txt', 'edited\n')
    write(base, 'untracked.txt', 'new\n')

    const out = await plan(dir, 'octocat/hello', 'main')

    expect(out).toMatchObject({
      ok: true,
      value: { kind: 'existing', risk: { tracking: 'origin/main', dirty: 2, unpushed: 1 } },
    })
  })

  it('refuses a repo name that is not owner and repo', async () => {
    expect(await plan(tmp('dir'), 'hello', 'main')).toEqual({ ok: false, error: { kind: 'bad-argument', value: 'hello' } })
  })

  it('reports every clone directory being taken rather than guessing a third', async () => {
    const dir = tmp('dir')
    cloned(dir, 'hello', origin('someone', 'hello'))
    const other = cloned(tmp('other'), 'hello', origin('third', 'hello'))
    fs.renameSync(other, path.join(dir, 'octocat-hello'))

    expect(await plan(dir, 'octocat/hello', 'main')).toEqual({
      ok: false,
      error: { kind: 'clone-dirs-taken', repo: 'octocat/hello' },
    })
  })
})

describe('create', () => {
  it('adds a sibling worktree on the remote branch', async () => {
    const dir = tmp('dir')
    const base = cloned(dir, 'hello', origin('octocat', 'hello'))
    const target = worktreePath(base, 'feature')

    const out = await create(base, target, 'feature', 'octocat/hello')

    expect(out).toEqual({ ok: true, value: { path: target, pulled: true, warning: null } })
    expect(fs.existsSync(path.join(target, 'b.txt'))).toBe(true)
    expect(sh(target, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature')
  })

  it('hands back the clone itself when it already holds the branch, as a fresh clone does', async () => {
    const dir = tmp('dir')
    const base = cloned(dir, 'hello', origin('octocat', 'hello'))

    const out = await create(base, worktreePath(base, 'main'), 'main', 'octocat/hello')

    expect(out).toMatchObject({ ok: true, value: { path: base } })
    expect(fs.existsSync(worktreePath(base, 'main'))).toBe(false)
  })

  it('reports a branch the remote does not have rather than inventing one', async () => {
    const dir = tmp('dir')
    const base = cloned(dir, 'hello', origin('octocat', 'hello'))

    const out = await create(base, worktreePath(base, 'ghost'), 'ghost', 'octocat/hello')

    expect(out).toMatchObject({ ok: false, error: { kind: 'failed' } })
  })
})

describe('keep', () => {
  it('replays the branch onto its tracking ref and keeps the uncommitted work', async () => {
    const dir = tmp('dir')
    const bare = origin('octocat', 'hello')
    const base = cloned(dir, 'hello', bare)
    pushed(bare, 'main', 'remote.txt', 'from elsewhere\n')
    write(base, 'a.txt', 'edited\n')

    const out = await keep(base, 'main', 'octocat/hello')

    expect(out).toEqual({ ok: true, value: { path: base, pulled: true, warning: null } })
    expect(fs.existsSync(path.join(base, 'remote.txt'))).toBe(true)
    expect(fs.readFileSync(path.join(base, 'a.txt'), 'utf8')).toBe('edited\n')
  })

  it('opens without pulling when the worktree sits on another branch', async () => {
    const dir = tmp('dir')
    const base = cloned(dir, 'hello', origin('octocat', 'hello'))

    const out = await keep(base, 'feature', 'octocat/hello')

    expect(out).toMatchObject({ ok: true, value: { pulled: false } })
    expect(out.ok && out.value.warning).toContain('worktree is on main')
  })

  it('opens without pulling when the branch has no tracking ref', async () => {
    const dir = tmp('dir')
    const base = cloned(dir, 'hello', origin('octocat', 'hello'))
    sh(base, 'checkout', '-b', 'solo')

    const out = await keep(base, 'solo', 'octocat/hello')

    expect(out).toMatchObject({ ok: true, value: { pulled: false } })
    expect(out.ok && out.value.warning).toContain('has no origin/solo')
  })

  it('rolls a conflicted replay back and leaves the worktree exactly as it was', async () => {
    const dir = tmp('dir')
    const bare = origin('octocat', 'hello')
    const base = cloned(dir, 'hello', bare)
    commit(base, 'a.txt', 'mine\n', 'local edit')
    const before = sh(base, 'rev-parse', 'HEAD').trim()
    pushed(bare, 'main', 'a.txt', 'theirs\n')

    const out = await keep(base, 'main', 'octocat/hello')

    expect(out).toMatchObject({ ok: true, value: { path: base, pulled: false } })
    expect(out.ok && out.value.warning).toContain('rolled back, worktree untouched')
    expect(sh(base, 'rev-parse', 'HEAD').trim()).toBe(before)
    expect(fs.readFileSync(path.join(base, 'a.txt'), 'utf8')).toBe('mine\n')
  })
})

describe('clean', () => {
  it('resets the main clone in place and leaves its linked worktrees alive', async () => {
    const dir = tmp('dir')
    const bare = origin('octocat', 'hello')
    const base = cloned(dir, 'hello', bare)
    const linked = worktreePath(base, 'feature')
    await create(base, linked, 'feature', 'octocat/hello')

    commit(base, 'a.txt', 'mine\n', 'local only')
    write(base, 'junk.txt', 'untracked\n')
    const remote = sh(base, 'rev-parse', 'origin/main').trim()

    const out = await clean(base, base, worktreePath(base, 'main'), 'main', 'octocat/hello')

    expect(out).toEqual({ ok: true, value: { path: base, pulled: true, warning: null } })
    expect(sh(base, 'rev-parse', 'HEAD').trim()).toBe(remote)
    expect(fs.existsSync(path.join(base, 'junk.txt'))).toBe(false)
    expect(fs.existsSync(path.join(linked, 'b.txt'))).toBe(true)
    expect(fs.existsSync(path.join(base, '.git', 'HEAD'))).toBe(true)
  })

  it('leaves the main clone untouched when the remote has no such branch', async () => {
    const dir = tmp('dir')
    const base = cloned(dir, 'hello', origin('octocat', 'hello'))
    sh(base, 'checkout', '-b', 'solo')
    commit(base, 'c.txt', 'mine\n', 'local only')
    const before = sh(base, 'rev-parse', 'HEAD').trim()

    const out = await clean(base, base, worktreePath(base, 'solo'), 'solo', 'octocat/hello')

    expect(out).toEqual({ ok: false, error: { kind: 'no-tracking', tracking: 'origin/solo' } })
    expect(sh(base, 'rev-parse', 'HEAD').trim()).toBe(before)
    expect(fs.existsSync(path.join(base, 'c.txt'))).toBe(true)
  })

  it('deletes a linked worktree and rebuilds it from the remote', async () => {
    const dir = tmp('dir')
    const base = cloned(dir, 'hello', origin('octocat', 'hello'))
    const linked = worktreePath(base, 'feature')
    await create(base, linked, 'feature', 'octocat/hello')
    commit(linked, 'd.txt', 'mine\n', 'local only')
    write(linked, 'b.txt', 'edited\n')

    const out = await clean(base, linked, linked, 'feature', 'octocat/hello')

    expect(out).toEqual({ ok: true, value: { path: linked, pulled: true, warning: null } })
    expect(fs.existsSync(path.join(linked, 'd.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(linked, 'b.txt'), 'utf8')).toBe('branch\n')
    expect(await risk(linked, 'feature', 'octocat/hello')).toMatchObject({ dirty: 0, unpushed: 0 })
  })
})
