import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Head } from '../../shared/types'
import { readTabTitle, tabTitle, type TitleRepo } from './title'

const main: TitleRepo = { top: '/Users/me/repo', gitDir: '/Users/me/repo/.git', common: '/Users/me/repo/.git' }
const tree: TitleRepo = {
  top: '/Users/me/repo/.claude/worktrees/zany-otter',
  gitDir: '/Users/me/repo/.git/worktrees/zany-otter',
  common: '/Users/me/repo/.git',
}
const branch: Head = { kind: 'branch', branch: 'fix/tabs', commit: 'abc' }

describe('tabTitle', () => {
  it('names a normal checkout by its repo', () => {
    expect(tabTitle('/Users/me/repo', main, branch)).toBe('repo')
  })

  it('names a worktree by the main repo and its branch, never the slug folder', () => {
    expect(tabTitle(tree.top, tree, branch)).toBe('repo · fix/tabs')
  })

  it('names a detached worktree by its short commit', () => {
    expect(tabTitle(tree.top, tree, { kind: 'detached', commit: '0123456789abcdef' })).toBe('repo · 01234567')
  })

  it('falls back to the worktree folder when the head is unknown', () => {
    expect(tabTitle(tree.top, tree, null)).toBe('repo · zany-otter')
  })

  it('keeps the subfolder when the root sits inside the repo', () => {
    expect(tabTitle('/Users/me/repo/pkg/a', main, branch)).toBe('repo/pkg/a')
  })

  it('strips .git from a bare repo name', () => {
    const bare = { top: '/srv/wt/feature', gitDir: '/srv/app.git/worktrees/feature', common: '/srv/app.git' }
    expect(tabTitle(bare.top, bare, branch)).toBe('app · fix/tabs')
  })

  it('uses the folder outside git, with or without a trailing slash', () => {
    expect(tabTitle('/Users/me/notes', null, null)).toBe('notes')
    expect(tabTitle('/Users/me/notes/', null, null)).toBe('notes')
  })

  it('falls back to Architect only when no name exists', () => {
    expect(tabTitle('/', null, null)).toBe('Architect')
    expect(tabTitle('', null, null)).toBe('Architect')
  })
})

describe('readTabTitle', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-title-'))
  const repo = path.join(base, 'shop')
  const linked = path.join(base, 'random-slug')
  const run = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' })

  fs.mkdirSync(repo)
  run(repo, 'init', '-q', '-b', 'main')
  run(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
  run(repo, 'worktree', 'add', '-q', '-b', 'feat/cart', linked)

  afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

  it('reads the repo name for the main checkout', async () => {
    expect(await readTabTitle(`${repo}/`)).toBe('shop')
  })

  it('reads the repo and branch for a linked worktree', async () => {
    expect(await readTabTitle(linked)).toBe('shop · feat/cart')
  })

  it('falls back to Architect for a missing root', async () => {
    expect(await readTabTitle('')).toBe('Architect')
  })
})
