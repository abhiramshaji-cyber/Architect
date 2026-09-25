import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { ClaudeWorktree, WorktreeSettings } from '../../shared/types'
import { byRecency, changedPaths, checkSettings, classify, defaults, discover, findRepos, readSettings, remove, saveSettings, survey, within } from './claude'
import { parseWorktrees } from './git'

const roots: string[] = []
const FOLDERS = ['.claude/worktrees']

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
  return { repo, name, path: `${repo}/.claude/worktrees/${name}`, branch: name, dirty: false, changedAt, broken: null, claude: true }
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
  const holders = ['/repo/.claude/worktrees']
  const known = parseWorktrees(porcelain).map((worktree) => ({ ...worktree, exists: worktree.path !== '/repo/.claude/worktrees/gone' }))

  it('lists every linked worktree git reports and marks the ones in a worktree folder as claude', () => {
    const found = [
      { path: '/repo/.claude/worktrees/with space', git: true },
      { path: '/repo/.claude/worktrees/loose', git: true },
    ]

    expect(classify('/repo', holders, found, known)).toEqual([
      { repo: '/repo', name: 'with space', path: '/repo/.claude/worktrees/with space', branch: 'claude/with-space', broken: null, claude: true },
      { repo: '/repo', name: 'loose', path: '/repo/.claude/worktrees/loose', branch: null, broken: null, claude: true },
      { repo: '/repo', name: 'gone', path: '/repo/.claude/worktrees/gone', branch: 'gone', broken: 'missing', claude: true },
      { repo: '/repo', name: 'side', path: '/elsewhere/side', branch: 'side', broken: null, claude: false },
    ])
  })

  it('counts a worktree under any configured folder, however deep, as claude', () => {
    expect(classify('/repo', ['/elsewhere'], [], known).filter((entry) => entry.claude).map((entry) => entry.name)).toEqual(['side'])
    expect(classify('/repo', [], [], known).some((entry) => entry.claude)).toBe(false)
  })

  it('marks folders git does not know about and skips containers of real worktrees', () => {
    const found = [
      { path: '/repo/.claude/worktrees/plain', git: false },
      { path: '/repo/.claude/worktrees/stray', git: true },
      { path: '/repo/.claude/worktrees', git: false },
    ]
    const nested = ['/repo/.claude', ...holders]

    expect(classify('/repo', nested, found, known.slice(0, 1)).map((entry) => [entry.name, entry.broken])).toEqual([
      ['plain', 'not-git'],
      ['stray', 'unregistered'],
    ])
    expect(classify('/repo', ['/repo/.claude'], [{ path: '/repo/.claude/worktrees', git: false }], known).map((entry) => entry.name)).not.toContain(
      'worktrees',
    )
  })

  it('marks every folder when the repo cannot list its worktrees', () => {
    expect(classify('/repo', holders, [{ path: '/repo/.claude/worktrees/a', git: true }], null)).toMatchObject([{ broken: 'unlisted' }])
  })

  it('never lists the main worktree and handles none at all', () => {
    expect(classify('/repo', holders, [], known).map((entry) => entry.path)).not.toContain('/repo')
    expect(classify('/repo', holders, [], [])).toEqual([])
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

function settings(roots: string[], worktreeFolders = FOLDERS, worktreeScanDepth = 6): WorktreeSettings {
  return { worktreeRoots: roots, worktreeScanDepth, worktreeFolders }
}

describe('findRepos', () => {
  it('finds repos by their .git and skips heavy folders and symlink loops', async () => {
    const home = tmp('home')
    const one = committed(path.join(home, 'code', 'one'))
    const nvim = committed(path.join(home, '.config', 'nvim'))
    fs.mkdirSync(path.join(home, 'code', 'plain', '.claude', 'worktrees'), { recursive: true })
    committed(path.join(home, 'node_modules', 'dep'))
    committed(path.join(home, 'Library', 'x'))
    fs.symlinkSync(home, path.join(home, 'code', 'loop'))

    expect((await findRepos([home], 6)).sort()).toEqual([nvim, one])
  })

  it('stops at the depth bound and survives missing, duplicate, nested and empty roots', async () => {
    const home = tmp('deep')
    const deep = committed(path.join(home, 'a', 'b', 'c'))

    expect(await findRepos([home], 2)).toEqual([])
    expect(await findRepos([home], 3)).toEqual([deep])
    expect(await findRepos([path.join(home, 'a'), home, home], 2)).toEqual([deep])
    expect(await findRepos([path.join(home, 'nope')], 6)).toEqual([])
    expect(await findRepos([], 6)).toEqual([])
  })

  it('reaches a main repo outside every root through a linked worktree inside one', async () => {
    const repo = committed(tmp('outside-repo'))
    const hub = tmp('hub')
    sh(repo, 'worktree', 'add', '-b', 'side', path.join(hub, 'side'))

    expect(await findRepos([hub], 2)).toEqual([repo])
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

    const found = await discover([], true, settings([home]))

    expect(found.map((entry) => [entry.name, entry.branch, entry.dirty, entry.broken, entry.claude])).toEqual([
      ['busy one', 'claude/busy', true, null, true],
      ['quiet', 'claude/quiet', false, null, true],
      ['gone', 'claude/gone', false, 'missing', true],
      ['plain', null, false, 'not-git', true],
    ])
    expect(found[0]?.changedAt).toBeGreaterThanOrEqual(found[1]?.changedAt ?? Infinity)
  })

  it('finds a sibling worktree, shown under all but not claude, until a custom folder claims it', async () => {
    const home = tmp('sibling')
    const root = committed(path.join(home, 'app'))
    const sibling = path.join(home, 'app-feature')
    sh(root, 'worktree', 'add', '-b', 'feature', sibling)

    const all = await discover([], true, settings([home]))
    expect(all.map((entry) => [entry.path, entry.claude])).toEqual([[sibling, false]])
    expect(all.filter((entry) => entry.claude)).toEqual([])

    const central = tmp('central')
    const kept = path.join(central, 'app', 'task')
    sh(root, 'worktree', 'add', '-b', 'task', kept)
    fs.mkdirSync(path.join(root, '.worktrees', 'loose'), { recursive: true })

    const custom = await discover([], true, settings([home], ['.worktrees', central]))
    expect(custom.map((entry) => [entry.path, entry.claude, entry.broken]).sort()).toEqual([
      [sibling, false, null],
      [path.join(root, '.worktrees', 'loose'), true, 'not-git'],
      [kept, true, null],
    ].sort())
  })

  it('scans a custom root outside home and honours the depth setting', async () => {
    const outside = tmp('elsewhere-root')
    const root = committed(path.join(outside, 'x', 'y', 'repo'))
    const target = worktree(root, 'deep', '-b', 'deep')

    expect(await discover([], true, settings([outside], FOLDERS, 2))).toEqual([])
    expect((await discover([], true, settings([outside], FOLDERS, 3))).map((entry) => entry.path)).toEqual([target])
    expect(await discover([], true, settings([]))).toEqual([])
  })

  it('refreshes from a known worktree root without scanning and dedupes repos', async () => {
    const home = tmp('known')
    const root = committed(path.join(home, 'repo'))
    const target = path.join(root, '.claude', 'worktrees', 'one')
    sh(root, 'worktree', 'add', '-b', 'one', target)

    const found = await discover([target, root, path.join(home, 'missing')], false, settings([path.join(home, 'unused')]))

    expect(found.map((entry) => entry.path)).toEqual([target])
  })

  it('returns nothing when there are no worktrees anywhere', async () => {
    expect(await discover([], true, settings([tmp('empty')]))).toEqual([])
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

    expect(await survey(repo, target, [], FOLDERS)).toEqual({
      ok: true,
      value: { kind: 'remove', dirty: 0, unpushed: 0, branch: 'claude/clean', base: 'main', merged: true },
    })
    expect(await remove(repo, target, KEEP, [], FOLDERS, NO_TRASH)).toEqual({
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

    expect(await remove(repo, target, { force: false, branch: true }, [], FOLDERS, NO_TRASH)).toEqual({
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

    const surveyed = await survey(repo, target, [], FOLDERS)
    expect(surveyed.ok && surveyed.value.kind === 'remove' && surveyed.value.dirty).toBe(2)

    const refused = await remove(repo, target, KEEP, [], FOLDERS, NO_TRASH)
    expect(refused.ok).toBe(false)
    if (refused.ok || refused.error.kind !== 'git') throw new Error('expected a git failure')
    expect(refused.error.left).toBe('both')
    expect(refused.error.error.kind === 'failed' && refused.error.error.stderr).toMatch(/--force/)
    expect(fs.readFileSync(path.join(target, 'new.txt'), 'utf8')).toBe('new\n')

    expect((await remove(repo, target, { force: true, branch: false }, [], FOLDERS, NO_TRASH)).ok).toBe(true)
    expect(fs.existsSync(target)).toBe(false)
  })

  it('counts commits on no remote and not in the default branch, and keeps that branch even when asked', async () => {
    const repo = published(committed(tmp('rm-unpushed')))
    const target = worktree(repo, 'ahead', '-b', 'claude/ahead')
    fs.writeFileSync(path.join(target, 'b.txt'), 'two\n')
    sh(target, 'add', 'b.txt')
    sh(target, 'commit', '-m', 'second')

    expect(await survey(repo, target, [], FOLDERS)).toEqual({
      ok: true,
      value: { kind: 'remove', dirty: 0, unpushed: 1, branch: 'claude/ahead', base: 'origin/main', merged: false },
    })

    sh(target, 'push', '-q', 'origin', 'claude/ahead')
    const pushed = await survey(repo, target, [], FOLDERS)
    expect(pushed.ok && pushed.value.kind === 'remove' && [pushed.value.unpushed, pushed.value.merged]).toEqual([0, false])

    expect(await remove(repo, target, { force: false, branch: true }, [], FOLDERS, NO_TRASH)).toEqual({
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

    expect(await survey(repo, target, [], FOLDERS)).toEqual({
      ok: true,
      value: { kind: 'remove', dirty: 0, unpushed: 1, branch: null, base: 'origin/main', merged: false },
    })
  })

  it('shows git refusing a locked worktree and leaves it in place', async () => {
    const repo = committed(tmp('rm-locked'))
    const target = worktree(repo, 'locked', '-b', 'claude/locked')
    sh(repo, 'worktree', 'lock', target)

    const refused = await remove(repo, target, { force: true, branch: false }, [], FOLDERS, NO_TRASH)
    if (refused.ok || refused.error.kind !== 'git') throw new Error('expected a git failure')
    expect(refused.error.left).toBe('both')
    expect(refused.error.error.kind === 'failed' && refused.error.error.stderr).toMatch(/locked/)
    expect(fs.existsSync(target)).toBe(true)
  })

  it('prunes a registered worktree whose folder is gone', async () => {
    const repo = committed(tmp('rm-missing'))
    const target = worktree(repo, 'gone', '-b', 'claude/gone')
    fs.rmSync(target, { recursive: true, force: true })

    expect(await survey(repo, target, [], FOLDERS)).toEqual({ ok: true, value: { kind: 'prune' } })
    expect(await remove(repo, target, KEEP, [], FOLDERS, NO_TRASH)).toEqual({
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

    expect(await remove(repo, target, KEEP, [], FOLDERS, NO_TRASH)).toEqual({
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

    expect(await survey(repo, target, [], FOLDERS)).toEqual({ ok: true, value: { kind: 'trash' } })
    expect(
      await remove(repo, target, KEEP, [], FOLDERS, async (item) => {
        trashed.push(item)
      }),
    ).toEqual({ ok: true, value: { how: 'trash', branch: null, branchError: null } })
    expect(trashed).toEqual([target])

    expect(
      await remove(repo, target, KEEP, [], FOLDERS, async () => {
        throw new Error('Operation not permitted')
      }),
    ).toEqual({ ok: false, error: { kind: 'trash-failed', path: target, message: 'Operation not permitted' } })
    expect(fs.existsSync(path.join(target, 'notes.txt'))).toBe(true)
  })

  it('leaves a folder with its own git alone when the repo does not list it', async () => {
    const repo = committed(tmp('rm-unregistered'))
    const target = committed(path.join(repo, '.claude', 'worktrees', 'clone'))

    expect(await remove(repo, target, KEEP, [], FOLDERS, NO_TRASH)).toEqual({
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
      expect(await remove(repo, target, KEEP, open, FOLDERS, NO_TRASH)).toEqual({ ok: false, error: { kind: 'open', path: target } })
    }
    expect(fs.existsSync(target)).toBe(true)
    expect((await survey(repo, target, [repo], FOLDERS)).ok).toBe(true)
  })

  it('refuses the main worktree, a folder holding it, and anything neither listed nor inside a worktree folder', async () => {
    const parent = tmp('rm-outside')
    const repo = committed(path.join(parent, 'repo'))
    const holder = path.join(repo, '.claude', 'worktrees')
    fs.mkdirSync(holder, { recursive: true })
    const elsewhere = tmp('rm-elsewhere')
    fs.symlinkSync(elsewhere, path.join(holder, 'link'))
    fs.writeFileSync(path.join(holder, 'file'), 'x\n')

    for (const target of [repo, parent]) {
      const refused = await remove(repo, target, KEEP, [], FOLDERS, NO_TRASH)
      expect(refused.ok ? null : refused.error.kind).toBe('main')
    }
    for (const target of [holder, path.join(holder, 'link'), path.join(holder, 'file'), elsewhere]) {
      const refused = await remove(repo, target, KEEP, [], FOLDERS, NO_TRASH)
      expect(refused.ok ? null : refused.error.kind).toBe('outside')
    }
    const deep = await remove(repo, path.join(holder, 'a', 'b'), KEEP, [], FOLDERS, NO_TRASH)
    expect(deep.ok ? null : deep.error.kind === 'git' && deep.error.error.kind).toBe('no-worktree')
    expect(fs.existsSync(elsewhere)).toBe(true)
  })

  it('removes a linked worktree that lives outside every worktree folder', async () => {
    const parent = tmp('rm-sibling')
    const repo = committed(path.join(parent, 'app'))
    const target = path.join(parent, 'app-feature')
    sh(repo, 'worktree', 'add', '-b', 'feature', target)

    expect(await remove(repo, target, KEEP, [], [], NO_TRASH)).toEqual({ ok: true, value: { how: 'remove', branch: null, branchError: null } })
    expect(fs.existsSync(target)).toBe(false)
    expect(listed(repo)).not.toContain(target)
  })

  it('refuses a folder that holds another worktree', async () => {
    const parent = tmp('rm-holds')
    const repo = committed(path.join(parent, 'app'))
    const outer = path.join(parent, 'outer')
    const inner = path.join(outer, 'inner')
    sh(repo, 'worktree', 'add', '-b', 'outer', outer)
    sh(repo, 'worktree', 'add', '-b', 'inner', inner)

    expect(await remove(repo, outer, { force: true, branch: false }, [], FOLDERS, NO_TRASH)).toEqual({
      ok: false,
      error: { kind: 'holds', path: outer, worktree: inner },
    })
    expect(fs.existsSync(path.join(inner, 'a.txt'))).toBe(true)
  })

  it('trashes a plain folder only inside a configured, repo relative worktree folder', async () => {
    const repo = committed(tmp('rm-plain-custom'))
    const custom = path.join(repo, '.worktrees', 'plain')
    const loose = path.join(repo, 'notes')
    fs.mkdirSync(custom, { recursive: true })
    fs.mkdirSync(loose)

    for (const [target, folders] of [[custom, FOLDERS], [loose, FOLDERS], [custom, [path.join(repo, '.worktrees')]]] as const) {
      const refused = await remove(repo, target, KEEP, [], [...folders], NO_TRASH)
      expect(refused.ok ? null : refused.error.kind).toBe('outside')
    }
    expect(await survey(repo, custom, [], ['.worktrees'])).toEqual({ ok: true, value: { kind: 'trash' } })
    expect(fs.existsSync(custom) && fs.existsSync(loose)).toBe(true)
  })

  it('reports a worktree that is already gone and a repo git cannot read', async () => {
    const repo = committed(tmp('rm-nothing'))
    const target = path.join(repo, '.claude', 'worktrees', 'never')
    expect(await remove(repo, target, KEEP, [], FOLDERS, NO_TRASH)).toEqual({
      ok: false,
      error: { kind: 'git', error: { kind: 'no-worktree', path: target }, left: 'neither' },
    })

    const bare = tmp('rm-not-repo')
    const inside = path.join(bare, '.claude', 'worktrees', 'x')
    fs.mkdirSync(inside, { recursive: true })
    const refused = await remove(bare, inside, KEEP, [], FOLDERS, NO_TRASH)
    expect(refused.ok ? null : refused.error.kind === 'git' && refused.error.error.kind).toBe('not-a-repo')
  })
})

describe('settings', () => {
  it('defaults to scanning home six deep for claude worktrees when nothing is stored or it is garbage', async () => {
    const dir = tmp('settings-default')
    expect(await readSettings(path.join(dir, 'none.json'), '/home/me')).toEqual(defaults('/home/me'))
    expect(defaults('/home/me')).toEqual({ worktreeRoots: ['/home/me'], worktreeScanDepth: 6, worktreeFolders: ['.claude/worktrees'] })

    const garbage = path.join(dir, 'garbage.json')
    fs.writeFileSync(garbage, '{not json')
    expect(await readSettings(garbage, '/home/me')).toEqual(defaults('/home/me'))
  })

  it('keeps each valid stored field, drops unsafe entries, and falls back per field', async () => {
    const file = path.join(tmp('settings-mixed'), 'settings.json')
    fs.writeFileSync(file, JSON.stringify({ worktreeRoots: ['/code', 'relative'], worktreeScanDepth: -1, worktreeFolders: ['..', '.', 'wt/', '/abs'] }))

    expect(await readSettings(file, '/home/me')).toEqual({ worktreeRoots: ['/code'], worktreeScanDepth: 6, worktreeFolders: ['wt', '/abs'] })
  })

  it('rejects a missing, relative, duplicate or file root, an escaping or empty folder, and a bad depth', async () => {
    const dir = tmp('settings-bad')
    const file = path.join(dir, 'file.txt')
    fs.writeFileSync(file, 'x')

    const checked = await checkSettings({
      worktreeRoots: [dir, `${dir}${path.sep}`, path.join(dir, 'nope'), 'relative', file],
      worktreeScanDepth: 1.5,
      worktreeFolders: ['../sibling', '.', '.claude/worktrees', '.claude/worktrees/', path.join(dir, 'gone')],
    })

    expect(checked.ok ? [] : checked.error.map((problem) => [problem.field, problem.kind])).toEqual([
      ['worktreeRoots', 'duplicate'],
      ['worktreeRoots', 'missing'],
      ['worktreeRoots', 'relative'],
      ['worktreeRoots', 'not-folder'],
      ['worktreeFolders', 'escapes'],
      ['worktreeFolders', 'empty'],
      ['worktreeFolders', 'duplicate'],
      ['worktreeFolders', 'missing'],
      ['worktreeScanDepth', 'depth'],
    ])
    const shapeless = await checkSettings(null)
    expect(shapeless.ok ? [] : shapeless.error.map((problem) => problem.kind)).toEqual(['not-list', 'not-list', 'depth'])
  })

  it('saves clean settings beside other keys, accepts zero roots, and leaves the file alone when invalid', async () => {
    const dir = tmp('settings-save')
    const file = path.join(dir, 'nested', 'settings.json')
    fs.mkdirSync(path.dirname(file))
    fs.writeFileSync(file, JSON.stringify({ other: 1 }))

    const saved = await saveSettings(file, { worktreeRoots: [`${dir}${path.sep}`], worktreeScanDepth: 0, worktreeFolders: ['wt/'] })
    expect(saved).toEqual({ ok: true, value: { worktreeRoots: [dir], worktreeScanDepth: 0, worktreeFolders: ['wt'] } })
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ other: 1, worktreeRoots: [dir], worktreeScanDepth: 0, worktreeFolders: ['wt'] })

    expect((await saveSettings(file, { worktreeRoots: [], worktreeScanDepth: 6, worktreeFolders: [] })).ok).toBe(true)
    expect((await saveSettings(file, { worktreeRoots: ['nope'], worktreeScanDepth: 6, worktreeFolders: [] })).ok).toBe(false)
    expect(await readSettings(file)).toEqual({ worktreeRoots: [], worktreeScanDepth: 6, worktreeFolders: [] })
  })
})
