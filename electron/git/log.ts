import type { Commit, GitResult } from '../../shared/types'
import { git } from './git'

export function parseLog(stdout: string): Commit[] {
  return stdout
    .split('\x1e')
    .filter(Boolean)
    .map((record) => {
      const cut = record.indexOf('\0')
      const [sha = '', short = '', at = '0', ...subject] = (cut < 0 ? record : record.slice(0, cut)).split('\x1f')
      const files = cut < 0 ? [] : record.slice(cut + 1).replace(/^\n/, '').split('\0').filter(Boolean)
      return { sha, short, at: Number(at) * 1000, subject: subject.join('\x1f'), files }
    })
}

export async function commitsSince(root: string, since: number): Promise<GitResult<Commit[]>> {
  const format = '--format=%x1e%H%x1f%h%x1f%ct%x1f%s'
  const out = await git(root, ['log', `--since=@${Math.floor(since / 1000)}`, '--relative', '--name-only', '-z', format, '--', '.'])
  if (out.ok) return { ok: true, value: parseLog(out.value) }
  return out.error.kind === 'no-commits' ? { ok: true, value: [] } : out
}
