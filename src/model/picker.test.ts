import { describe, expect, it } from 'vitest'
import {
  dirtyPrompt,
  removalMessage,
  removalPrompt,
  removedText,
  agoText,
  authNote,
  distanceText,
  isClaudeWorktree,
  worktreeText,
  entered,
  escaped,
  gitMessage,
  githubMessage,
  moved,
  openMessage,
  rank,
  riskText,
  score,
  START,
  typed,
} from './picker'
import type { ClaudeWorktree, GithubRepo, OpenRisk } from '../../shared/types'

function repo(nameWithOwner: string): GithubRepo {
  const [owner = '', name = ''] = nameWithOwner.split('/')
  return {
    nameWithOwner,
    name,
    owner,
    description: '',
    isPrivate: false,
    isFork: false,
    isArchived: false,
    defaultBranch: 'main',
    pushedAt: null,
    url: '',
    language: null,
  }
}

function risk(dirty: number, unpushed: number): OpenRisk {
  return { tracking: 'origin/main', dirty, unpushed, dirtyFiles: [], unpushedCommits: [] }
}

describe('score', () => {
  it('matches letters in order rather than as a substring', () => {
    expect(score('abc', 'a-b-c')).not.toBe(null)
    expect(score('cba', 'a-b-c')).toBe(null)
  })

  it('takes every candidate when the query is empty', () => {
    expect(score('', 'anything')).toBe(0)
  })

  it('ignores case and whitespace in the query', () => {
    expect(score('BO T', 'botpress/thing')).not.toBe(null)
  })
})

describe('rank', () => {
  it('puts a run of consecutive letters above the same letters scattered', () => {
    const out = rank('arch', [repo('me/a-r-c-h-ive'), repo('me/architect')], (item) => item.nameWithOwner)

    expect(out.map((item) => item.name)).toEqual(['architect', 'a-r-c-h-ive'])
  })

  it('rewards a match on a word boundary over one buried inside a word', () => {
    const out = rank('arch', [repo('me/search-tool'), repo('me/architect')], (item) => item.nameWithOwner)

    expect(out[0]?.name).toBe('architect')
  })

  it('drops everything that does not match at all', () => {
    const out = rank('zz', [repo('me/architect'), repo('me/zzebra')], (item) => item.nameWithOwner)

    expect(out.map((item) => item.name)).toEqual(['zzebra'])
  })
})

describe('two pass navigation', () => {
  it('moves to the branch pass on enter and clears the query', () => {
    const next = entered(typed(START, 'arch'), repo('me/architect'))

    expect(next).toEqual({ stage: { kind: 'branches', repo: repo('me/architect') }, query: '', index: 0 })
  })

  it('stays on the branch pass when enter arrives there', () => {
    const branches = entered(START, repo('me/architect'))

    expect(entered(branches, repo('me/other'))).toBe(branches)
  })

  it('escapes from branches back to repos rather than closing', () => {
    expect(escaped(entered(START, repo('me/architect')))).toEqual(START)
  })

  it('escapes from repos by closing', () => {
    expect(escaped(START)).toBe(null)
  })

  it('clamps movement to the rows on show and resets the highlight as you type', () => {
    expect(moved(START, -1, 3).index).toBe(0)
    expect(moved({ ...START, index: 2 }, 1, 3).index).toBe(2)
    expect(moved(START, 1, 0).index).toBe(0)
    expect(typed({ ...START, index: 2 }, 'a').index).toBe(0)
  })
})

describe('riskText', () => {
  it('names both kinds of loss with singular and plural handled', () => {
    expect(riskText(risk(1, 2))).toBe('1 uncommitted file + 2 unpushed commits')
    expect(riskText(risk(3, 1))).toBe('3 uncommitted files + 1 unpushed commit')
  })

  it('names only the kind that is at risk', () => {
    expect(riskText(risk(2, 0))).toBe('2 uncommitted files')
    expect(riskText(risk(0, 2))).toBe('2 unpushed commits')
  })

  it('says nothing local when there is nothing to lose', () => {
    expect(riskText(risk(0, 0))).toBe('nothing local')
  })
})

describe('failure text', () => {
  it('offers the sign in command when the account is signed out', () => {
    expect(authNote({ kind: 'logged-out', host: 'github.com' })).toEqual({
      text: 'Signed out of github.com',
      action: 'gh auth login',
    })
  })

  it('offers the refresh command naming the scope that is missing', () => {
    const account = { host: 'github.com', login: 'octocat', scopes: ['gist'] }

    expect(authNote({ kind: 'insufficient-scopes', account, missing: ['repo'] })).toEqual({
      text: 'octocat is missing the repo scope',
      action: 'gh auth refresh -h github.com -s repo',
    })
  })

  it('says nothing when the account is signed in', () => {
    expect(authNote({ kind: 'logged-in', account: { host: 'github.com', login: 'octocat', scopes: ['repo'] } })).toBe(null)
  })

  it('names the clone directory collision rather than a raw git failure', () => {
    expect(gitMessage({ kind: 'clone-dirs-taken', repo: 'octocat/hello' })).toBe(
      'Every clone dir for octocat/hello is taken by another repo',
    )
  })

  it('reads a failure from either side of the open', () => {
    expect(openMessage({ source: 'github', error: { kind: 'not-installed' } })).toBe('The gh CLI is not installed')
    expect(openMessage({ source: 'git', error: { kind: 'no-tracking', tracking: 'origin/x' } })).toContain('origin/x')
    expect(githubMessage({ kind: 'auth-required' })).toContain('gh auth login')
  })
})

describe('worktree text', () => {
  const now = Date.UTC(2026, 0, 31)
  const worktree: ClaudeWorktree = {
    repo: '/r',
    name: 'w',
    path: '/r/.claude/worktrees/w',
    branch: null,
    dirty: true,
    changedAt: now - 5 * 60_000,
    broken: null,
  }

  it('says how long ago a worktree changed', () => {
    expect(agoText(null, now)).toBe('never changed')
    expect(agoText(now - 10_000, now)).toBe('changed just now')
    expect(agoText(now - 3 * 3_600_000, now)).toBe('changed 3h ago')
    expect(agoText(now - 86_400_000, now)).toBe('changed yesterday')
    expect(agoText(now - 5 * 86_400_000, now)).toBe('changed 5 days ago')
  })

  it('shows a detached, dirty worktree and a broken one', () => {
    expect(worktreeText(worktree, now)).toBe('detached · uncommitted changes · changed 5 min ago')
    expect(worktreeText({ ...worktree, broken: 'missing' }, now)).toBe('broken · its folder is gone')
  })

  it('counts distance and rejects cached rows of the wrong shape', () => {
    expect(distanceText({ ahead: 2, behind: 0 })).toBe('2 ahead')
    expect(distanceText({ ahead: 0, behind: 0 })).toBe('in sync')
    expect([worktree, null, { repo: 1 }, 'x'].filter(isClaudeWorktree)).toEqual([worktree])
  })
})

describe('removal text', () => {
  const worktree: ClaudeWorktree = {
    repo: '/code/app',
    name: 'feat',
    path: '/code/app/.claude/worktrees/feat',
    branch: 'claude/feat',
    dirty: true,
    changedAt: null,
    broken: null,
  }

  it('names the repo, the worktree and the path, and warns about unpushed commits', () => {
    const plan = { kind: 'remove', dirty: 0, unpushed: 2, branch: 'claude/feat', base: 'origin/main', merged: false } as const
    const text = removalPrompt(worktree, plan)
    for (const part of ['feat', '/code/app', worktree.path, 'claude/feat is kept', '2 commits', 'origin/main']) expect(text).toContain(part)
    expect(removalPrompt(worktree, { ...plan, branch: null, unpushed: 1 })).toContain('reflog')
    expect(removalPrompt(worktree, { ...plan, unpushed: 0 })).not.toContain('WARNING')
    expect(removalPrompt(worktree, { kind: 'prune' })).toContain('git worktree prune')
    expect(removalPrompt(worktree, { kind: 'trash' })).toContain('Trash')
  })

  it('counts dirty files and says what a failure left behind', () => {
    expect(dirtyPrompt(worktree, 1)).toContain('1 file in feat has')
    expect(dirtyPrompt(worktree, 3)).toContain('3 files in feat have')
    expect(removalMessage({ kind: 'open', path: worktree.path })).toContain('Close it first')
    expect(
      removalMessage({ kind: 'git', error: { kind: 'failed', args: ['worktree', 'remove'], code: 128, stderr: 'Permission denied' }, left: 'folder' }),
    ).toBe('git worktree remove failed: Permission denied. Now git no longer lists it, but its folder is still there.')
    expect(removedText(worktree, { how: 'remove', branch: null, branchError: { kind: 'failed', args: ['branch', '-d'], code: 1, stderr: 'not fully merged' } })).toBe(
      'Deleted app / feat, but kept its branch: git branch -d failed: not fully merged',
    )
    expect(removedText(worktree, { how: 'remove', branch: 'claude/feat', branchError: null })).toBe('Deleted app / feat and its branch claude/feat')
  })
})
