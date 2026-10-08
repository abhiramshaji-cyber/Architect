import { folderName } from './layout'
import { plural, removalMessage } from './picker'
import type { ClaudeWorktree, RemovalResult, WorktreeRemoval, WorktreeRemoved } from '../../shared/types'

const STALE_AFTER = 3 * 86_400_000

export type Planned = { worktree: ClaudeWorktree; plan: WorktreeRemoval }

export type Skipped = { worktree: ClaudeWorktree; reason: string }

export type Removed = Planned & { removed: WorktreeRemoved }

export type Review = { ready: Planned[]; skipped: Skipped[] }

export function worktreeLabel(worktree: ClaudeWorktree): string {
  return `${folderName(worktree.repo)} / ${worktree.name}`
}

export function isStale(worktree: ClaudeWorktree, now: number): boolean {
  if (worktree.broken) return worktree.broken === 'missing'
  return !worktree.dirty && worktree.changedAt !== null && now - worktree.changedAt >= STALE_AFTER
}

export function isDirty(row: Planned): boolean {
  return row.plan.kind === 'remove' && row.plan.dirty > 0
}

export function isUnpushed(row: Planned): boolean {
  return row.plan.kind === 'remove' && row.plan.unpushed > 0
}

export function reviewed(rows: (Planned | Skipped)[]): Review {
  const ready: Planned[] = []
  const skipped: Skipped[] = []

  for (const row of rows) {
    if ('reason' in row) skipped.push(row)
    else if (row.plan.kind === 'remove' && row.plan.branch === null && row.plan.unpushed > 0) {
      skipped.push({ worktree: row.worktree, reason: `its detached HEAD holds ${plural(row.plan.unpushed, 'commit')} on no branch or remote, so put them on a branch first` })
    } else ready.push(row)
  }

  return { ready, skipped }
}

export function byRepo(rows: Planned[]): Planned[][] {
  const groups = new Map<string, Planned[]>()
  for (const row of rows) groups.set(row.worktree.repo, [...(groups.get(row.worktree.repo) ?? []), row])
  return [...groups.values()]
}

export function settled(row: Planned, result: RemovalResult<WorktreeRemoved>): Removed | Skipped {
  if (result.ok) return { ...row, removed: result.value }

  // an earlier prune in the same repo already dropped this entry
  const pruned = row.plan.kind === 'prune' && result.error.kind === 'git' && result.error.error.kind === 'no-worktree'
  if (pruned) return { ...row, removed: { how: 'prune', branch: null, branchError: null } }

  return { worktree: row.worktree, reason: removalMessage(result.error) }
}
