import type { Change, Touch } from '../../../shared/types'

const HEADER = /^([0-9a-f]{40}|[0-9a-f]{64}) \d+ (\d+)/
const UNCOMMITTED = /^0+$/

export function parseBlame(stdout: string): Change[] {
  const lines: Change[] = []
  const commits = new Map<string, Touch>()
  let current: Touch | null = null
  let final = 0

  for (const text of stdout.split('\n')) {
    if (text.startsWith('\t')) {
      if (current && final > 0) lines[final - 1] = UNCOMMITTED.test(current.sha) ? 'uncommitted' : current
      continue
    }
    const head = HEADER.exec(text)
    if (head) {
      const sha = head[1] ?? ''
      current = commits.get(sha) ?? { at: 0, sha, subject: '' }
      commits.set(sha, current)
      final = Number(head[2])
    } else if (current && text.startsWith('committer-time ')) current.at = Number(text.slice(15)) * 1000
    else if (current && text.startsWith('summary ')) current.subject = text.slice(8)
  }

  return lines
}
