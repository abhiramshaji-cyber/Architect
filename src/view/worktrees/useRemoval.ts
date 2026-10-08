import { useState } from 'react'
import { pooled } from '../../../shared/pool'
import { removalMessage } from '../../model/picker'
import { byRepo, isDirty, reviewed, settled, type Planned, type Removed, type Review, type Skipped } from '../../model/removal'
import type { ClaudeWorktree } from '../../../shared/types'

export type Stage =
  | { kind: 'idle' }
  | { kind: 'surveying'; total: number }
  | { kind: 'review'; review: Review; force: boolean; branches: boolean }
  | { kind: 'removing'; done: number; total: number }
  | { kind: 'done'; total: number; removed: Removed[]; failed: Skipped[]; skipped: Skipped[]; left: number }

const IDLE: Stage = { kind: 'idle' }

async function surveyed(worktree: ClaudeWorktree): Promise<Planned | Skipped> {
  try {
    const result = await window.architect.claudeWorktreeSurvey(worktree.repo, worktree.path)
    return result.ok ? { worktree, plan: result.value } : { worktree, reason: removalMessage(result.error) }
  } catch (err) {
    return { worktree, reason: String(err) }
  }
}

async function removed(row: Planned, force: boolean, branch: boolean): Promise<Removed | Skipped> {
  try {
    return settled(row, await window.architect.claudeWorktreeRemove(row.worktree.repo, row.worktree.path, { force: force && isDirty(row), branch }))
  } catch (err) {
    return { worktree: row.worktree, reason: String(err) }
  }
}

export function useRemoval(drop: (path: string) => void, refresh: () => void) {
  const [stage, setStage] = useState<Stage>(IDLE)

  async function survey(worktrees: ClaudeWorktree[]): Promise<void> {
    if (worktrees.length === 0) return
    setStage({ kind: 'surveying', total: worktrees.length })
    setStage({ kind: 'review', review: reviewed(await pooled(worktrees, surveyed)), force: false, branches: true })
  }

  // one repo at a time per lane: concurrent worktree remove and branch -d in one repo fight over git locks
  async function remove(review: Review, force: boolean, branches: boolean): Promise<void> {
    const chosen = review.ready.filter((row) => force || !isDirty(row))
    let done = 0
    setStage({ kind: 'removing', done, total: chosen.length })

    const results = await pooled(byRepo(chosen), async (group) => {
      const out: (Removed | Skipped)[] = []
      for (const row of group) {
        const result = await removed(row, force, branches)
        if ('removed' in result) drop(row.worktree.path)
        out.push(result)
        done += 1
        setStage({ kind: 'removing', done, total: chosen.length })
      }
      return out
    })

    const flat = results.flat()
    setStage({
      kind: 'done',
      total: chosen.length,
      removed: flat.filter((row): row is Removed => 'removed' in row),
      failed: flat.filter((row): row is Skipped => 'reason' in row),
      skipped: review.skipped,
      left: review.ready.length - chosen.length,
    })
    refresh()
  }

  return { stage, setStage, survey, remove }
}
