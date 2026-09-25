import type {
  ClaudeWorktree,
  DraftFailure,
  GitFailure,
  GithubAuth,
  GithubFailure,
  GithubRepo,
  OpenFailure,
  OpenRisk,
  WorktreeBroken,
} from '../../shared/types'

export type Stage = { kind: 'repos' } | { kind: 'branches'; repo: GithubRepo }

export type PickerState = { stage: Stage; query: string; index: number }

export const START: PickerState = { stage: { kind: 'repos' }, query: '', index: 0 }

const BOUNDARIES = new Set(['/', '-', '_', '.', ' ', '#'])

function boundary(text: string, at: number): boolean {
  const before = text[at - 1]
  return before === undefined || BOUNDARIES.has(before)
}

export function score(query: string, text: string): number | null {
  const needle = query.toLowerCase().replace(/\s+/g, '')
  if (needle === '') return 0

  const hay = text.toLowerCase()
  let total = 0
  let previous = -1

  for (const char of needle) {
    const found = hay.indexOf(char, previous + 1)
    if (found === -1) return null

    const gap = previous === -1 ? found : found - previous - 1
    total += previous !== -1 && gap === 0 ? 8 : boundary(hay, found) ? 6 : 1
    total -= Math.min(gap, 10) * 0.3
    previous = found
  }

  return total - text.length * 0.01
}

export function rank<T>(query: string, items: T[], key: (item: T) => string): T[] {
  return items
    .map((item) => ({ item, score: score(query, key(item)) }))
    .filter((row): row is { item: T; score: number } => row.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.item)
}

export function typed(state: PickerState, query: string): PickerState {
  return { ...state, query, index: 0 }
}

export function moved(state: PickerState, delta: number, count: number): PickerState {
  if (count === 0) return { ...state, index: 0 }
  return { ...state, index: Math.min(Math.max(state.index + delta, 0), count - 1) }
}

export function entered(state: PickerState, repo: GithubRepo): PickerState {
  if (state.stage.kind === 'branches') return state
  return { stage: { kind: 'branches', repo }, query: '', index: 0 }
}

export function escaped(state: PickerState): PickerState | null {
  return state.stage.kind === 'branches' ? START : null
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function riskText(risk: OpenRisk): string {
  const parts: string[] = []
  if (risk.dirty > 0) parts.push(plural(risk.dirty, 'uncommitted file'))
  if (risk.unpushed > 0) parts.push(plural(risk.unpushed, 'unpushed commit'))

  return parts.length > 0 ? parts.join(' + ') : 'nothing local'
}

export function authNote(auth: GithubAuth): { text: string; action: string } | null {
  if (auth.kind === 'logged-in') return null
  if (auth.kind === 'insufficient-scopes') {
    return { text: `${auth.account.login} is missing the ${auth.missing.join(', ')} scope`, action: `gh auth refresh -h ${auth.account.host} -s ${auth.missing.join(',')}` }
  }
  if (auth.kind === 'logged-out') return { text: `Signed out of ${auth.host}`, action: 'gh auth login' }
  if (auth.kind === 'not-installed') return { text: 'The gh CLI is not installed', action: 'brew install gh' }

  return { text: `${auth.host} is unreachable`, action: 'Check the connection, then refresh' }
}

export function githubMessage(error: GithubFailure): string {
  if (error.kind === 'not-installed') return 'The gh CLI is not installed'
  if (error.kind === 'auth-required') return 'GitHub needs you to sign in again: gh auth login'
  if (error.kind === 'not-found') return 'GitHub has no such repository, or the token cannot reach it'
  if (error.kind === 'bad-argument') return `GitHub refused the value ${error.value}`
  if (error.kind === 'rate-limited') {
    return `GitHub rate limit spent on ${error.resource}, back at ${new Date(error.resetAt).toLocaleTimeString()}`
  }
  if (error.kind === 'unreachable') return `github.com is unreachable: ${error.detail}`
  if (error.kind === 'timed-out') return `gh ${error.args.join(' ')} timed out`
  if (error.kind === 'unreadable') return `gh ${error.args.join(' ')} answered in a shape we cannot read`

  return `gh ${error.args.join(' ')} failed: ${error.stderr}`
}

export function gitMessage(error: GitFailure): string {
  if (error.kind === 'not-installed') return 'The git binary is not installed'
  if (error.kind === 'missing-root') return `${error.root} does not exist`
  if (error.kind === 'not-a-repo') return `${error.root} is not a git repository`
  if (error.kind === 'no-commits') return `${error.root} has no commits yet`
  if (error.kind === 'no-remote') return `${error.root} has no remote`
  if (error.kind === 'no-default-branch') return `${error.remote} has no default branch`
  if (error.kind === 'bad-ref') return `No such ref: ${error.ref}`
  if (error.kind === 'not-in-ref') return `${error.file} is not in ${error.ref}`
  if (error.kind === 'bad-argument') return `git refused the value ${error.value}`
  if (error.kind === 'invalid-branch') return `${error.name} is not a valid branch name`
  if (error.kind === 'branch-exists') return `${error.name} already exists`
  if (error.kind === 'branch-checked-out') return `${error.name} is already checked out at ${error.path}`
  if (error.kind === 'worktree-exists') return `${error.path} is already there`
  if (error.kind === 'no-worktree') return `No worktree at ${error.path}`
  if (error.kind === 'main-worktree') return `${error.path} is the clone itself`
  if (error.kind === 'locked-worktree') return `${error.path} is locked`
  if (error.kind === 'dirty') return `${error.root} has uncommitted changes`
  if (error.kind === 'clone-dirs-taken') return `Every clone dir for ${error.repo} is taken by another repo`
  if (error.kind === 'no-tracking') return `No ${error.tracking} to reset onto: left the branch untouched`
  if (error.kind === 'worktree-stuck') return `Could not remove ${error.path}. Clear it by hand, then reopen.`
  if (error.kind === 'nothing-staged') return 'Nothing is staged, so there is nothing to commit'
  if (error.kind === 'detached-head') return 'HEAD is detached, so there is no branch to push'
  if (error.kind === 'no-upstream') return `${error.branch} has no upstream yet, so push it first`
  if (error.kind === 'non-fast-forward') return `${error.branch} moved on the remote, so pull before you push again`
  if (error.kind === 'auth-failed') return `${error.remote} refused the credentials: gh auth login`
  if (error.kind === 'unreachable') return `${error.remote} cannot be reached from here`
  if (error.kind === 'diverged') return `The branch is ${error.ahead} ahead and ${error.behind} behind, so it cannot fast forward`
  if (error.kind === 'conflicted') return `${error.files} file${error.files === 1 ? '' : 's'} still has a merge conflict`

  return `git ${error.args.join(' ')} failed: ${error.stderr}`
}

export function draftMessage(error: DraftFailure): string {
  if (error.kind === 'not-installed') return 'Claude Code is not on your PATH, so there is nobody to ask'
  if (error.kind === 'nothing-to-draft') return 'There is nothing here to write about yet'
  if (error.kind === 'timed-out') return 'Claude took too long, so nothing was written'
  if (error.kind === 'unusable') return `Claude replied with something unusable (${error.detail}), so the fields were left alone`
  if (error.kind === 'no-skill') return `No ${error.name} instructions were found in .claude, so there is nothing to follow`
  if (error.kind === 'git') return gitMessage(error.error)

  return `claude exited ${error.code}: ${error.stderr}`
}

export function openMessage(failure: OpenFailure): string {
  return failure.source === 'git' ? gitMessage(failure.error) : githubMessage(failure.error)
}

export function cached<T>(key: string): T[] {
  try {
    const stored = localStorage.getItem(key)
    const rows: unknown = stored ? JSON.parse(stored) : null
    return Array.isArray(rows) ? (rows as T[]) : []
  } catch {
    return []
  }
}

export function cache(key: string, rows: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(rows))
  } catch {}
}

export function distanceText(distance: { ahead: number; behind: number } | undefined): string {
  if (!distance) return ''
  if (distance.ahead === 0 && distance.behind === 0) return 'in sync'

  return [distance.ahead > 0 ? `${distance.ahead} ahead` : '', distance.behind > 0 ? `${distance.behind} behind` : '']
    .filter((part) => part !== '')
    .join(' · ')
}

export function agoText(at: number | null, now: number): string {
  if (at === null) return 'never changed'

  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'changed just now'
  if (minutes < 60) return `changed ${minutes} min ago`
  if (minutes < 1440) return `changed ${Math.floor(minutes / 60)}h ago`

  const days = Math.floor(minutes / 1440)
  if (days === 1) return 'changed yesterday'
  if (days < 30) return `changed ${days} days ago`

  return `changed ${new Date(at).toLocaleDateString()}`
}

export const BROKEN_TEXT: Record<WorktreeBroken, string> = {
  missing: 'its folder is gone',
  'not-git': 'the folder has no git checkout',
  unregistered: 'the repo does not list it as a worktree',
  unlisted: 'the repo could not list its worktrees',
  unreadable: 'git cannot read it',
}

export function worktreeText(worktree: ClaudeWorktree, now: number): string {
  if (worktree.broken) return `broken · ${BROKEN_TEXT[worktree.broken]}`

  return [worktree.branch ?? 'detached', worktree.dirty ? 'uncommitted changes' : 'clean', agoText(worktree.changedAt, now)].join(' · ')
}

export function isClaudeWorktree(value: unknown): value is ClaudeWorktree {
  const row = value as Partial<ClaudeWorktree> | null
  return typeof row?.repo === 'string' && typeof row.name === 'string' && typeof row.path === 'string'
}
