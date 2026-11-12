export type Hunk = { oldStart: number; oldCount: number; newStart: number; newCount: number }

export type Section = { created: boolean; deleted: boolean; hunks: Hunk[] }

export type PatchCommit = { sha: string; sections: Section[] }

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export function createPatchReader() {
  const commits: PatchCommit[] = []
  let commit: PatchCommit | null = null
  let section: Section | null = null
  let body = 0

  function line(text: string) {
    if (body > 0) {
      if (!text.startsWith('\\')) body -= 1
      return
    }

    if (text.startsWith('\x1e')) {
      commit = { sha: text.slice(1).split('\x1f')[0] ?? '', sections: [] }
      commits.push(commit)
      section = null
      return
    }

    if (text.startsWith('diff --git ')) {
      if (!commit) {
        commit = { sha: '', sections: [] }
        commits.push(commit)
      }
      section = { created: false, deleted: false, hunks: [] }
      commit.sections.push(section)
      return
    }

    if (!section) return
    if (text.startsWith('new file mode ')) section.created = true
    if (text.startsWith('deleted file mode ')) section.deleted = true

    const header = HEADER.exec(text)
    if (!header) return
    const [, oldStart = '0', oldCount = '1', newStart = '0', newCount = '1'] = header
    const hunk = { oldStart: Number(oldStart), oldCount: Number(oldCount), newStart: Number(newStart), newCount: Number(newCount) }
    section.hunks.push(hunk)
    body = hunk.oldCount + hunk.newCount
  }

  return { line, commits: () => commits }
}
