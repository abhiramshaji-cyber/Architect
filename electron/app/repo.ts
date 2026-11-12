import type { OpenChoice, OpenResult, OpenedBranch } from '../../shared/types'
import * as open from '../git/open'
import * as github from '../github/github'

export async function openRepoBranch(
  repo: string,
  branch: string,
  choice: OpenChoice,
  pr?: number,
): Promise<OpenResult<OpenedBranch>> {
  const planned = await open.plan(open.GITHUB_DIR, repo, branch, pr)
  if (!planned.ok) return { ok: false, error: { source: 'git', error: planned.error } }

  const target = planned.value
  if (target.kind === 'clone') {
    const cloned = await github.clone(repo, target.basePath)
    if (!cloned.ok) return { ok: false, error: { source: 'github', error: cloned.error } }
  }

  const opened =
    target.kind !== 'existing'
      ? await open.create(target.basePath, target.worktreePath, branch, repo, pr)
      : choice === 'keep'
        ? await open.keep(target.existing, branch, repo)
        : await open.clean(target.basePath, target.existing, target.worktreePath, branch, repo, pr)

  return opened.ok ? opened : { ok: false, error: { source: 'git', error: opened.error } }
}
