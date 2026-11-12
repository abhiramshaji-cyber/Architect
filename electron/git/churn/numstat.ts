export type FileStat = { path: string; from?: string; added: number; removed: number; binary: boolean }

export type CommitStat = { sha: string; at: number; files: FileStat[] }

const COUNTS = /^\n?(\d+|-)\t(\d+|-)\t([\s\S]*)$/

export function parseNumstat(stdout: string): CommitStat[] {
  const tokens = stdout.split('\0')
  const commits: CommitStat[] = []
  let current: CommitStat | null = null

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? ''
    const header = token.replace(/^\n/, '')
    if (header.startsWith('\x1e')) {
      const [sha = '', at = '0'] = header.slice(1).split('\x1f')
      current = { sha, at: Number(at) * 1000, files: [] }
      commits.push(current)
      continue
    }

    const counts = COUNTS.exec(token)
    if (!counts) continue
    if (!current) {
      current = { sha: '', at: 0, files: [] }
      commits.push(current)
    }

    const [, added = '-', removed = '-', path = ''] = counts
    const binary = added === '-' || removed === '-'
    const lines = { added: binary ? 0 : Number(added), removed: binary ? 0 : Number(removed), binary }
    if (path !== '') {
      current.files.push({ path, ...lines })
      continue
    }
    const from = tokens[i + 1] ?? ''
    const to = tokens[i + 2] ?? ''
    i += 2
    current.files.push({ path: to, from, ...lines })
  }
  return commits
}
