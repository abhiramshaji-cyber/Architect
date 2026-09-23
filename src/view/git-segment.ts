import type { GitResult, GitStatus, Head } from '../../shared/types'
import { truncate } from './segments'

const BRANCH_MAX = 24

function headText(head: Head): string {
  if (head.kind === 'detached') return head.commit ? `detached at ${head.commit.slice(0, 8)}` : ''
  return truncate(head.branch, BRANCH_MAX)
}

export function gitText(result: GitResult<GitStatus> | null): string {
  if (!result || !result.ok) return ''

  const status = result.value
  const head = headText(status.head)
  if (!head) return ''

  const parts = [head]
  if (status.dirty) parts.push('[+]')

  if (status.upstream) {
    if (status.ahead > 0) parts.push(`${status.ahead} ahead`)
    if (status.behind > 0) parts.push(`${status.behind} behind`)
  }

  return parts.join(' ')
}
