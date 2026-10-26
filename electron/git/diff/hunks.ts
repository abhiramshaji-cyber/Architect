import parseDiff from 'parse-diff'
import type { DiffHunk, DiffRow, DiffSide } from '../../../shared/types'

function side(line: number, content: string): DiffSide {
  return { line, text: content.slice(1), noNewline: false }
}

function markNoNewline(rows: DiffRow[], dels: DiffSide[], adds: DiffSide[], type: parseDiff.ChangeType): void {
  const last = rows[rows.length - 1]

  if (type === 'del') {
    const target = dels[dels.length - 1] ?? last?.old
    if (target) target.noNewline = true
    return
  }

  if (type === 'add') {
    const target = adds[adds.length - 1] ?? last?.new
    if (target) target.noNewline = true
    return
  }

  if (last?.old) last.old.noNewline = true
  if (last?.new) last.new.noNewline = true
}

export function alignChanges(changes: parseDiff.Change[]): DiffRow[] {
  const rows: DiffRow[] = []
  let dels: DiffSide[] = []
  let adds: DiffSide[] = []

  function flush(): void {
    const span = Math.max(dels.length, adds.length)
    for (let i = 0; i < span; i += 1) rows.push({ old: dels[i] ?? null, new: adds[i] ?? null, context: false })
    dels = []
    adds = []
  }

  for (const change of changes) {
    if (change.content.startsWith('\\')) {
      markNoNewline(rows, dels, adds, change.type)
      continue
    }

    if (change.type === 'normal') {
      flush()
      rows.push({ old: side(change.ln1, change.content), new: side(change.ln2, change.content), context: true })
      continue
    }

    if (change.type === 'del') {
      if (adds.length > 0) flush()
      dels.push(side(change.ln, change.content))
      continue
    }

    adds.push(side(change.ln, change.content))
  }

  flush()
  return rows
}

export function toHunks(patch: string): DiffHunk[] {
  return parseDiff(patch).flatMap((file) =>
    file.chunks.map((chunk) => ({
      header: chunk.content,
      oldStart: chunk.oldStart,
      oldLines: chunk.oldLines,
      newStart: chunk.newStart,
      newLines: chunk.newLines,
      rows: alignChanges(chunk.changes),
    })),
  )
}

export function addedPatch(text: string): DiffHunk[] {
  const lines = text.split('\n')
  const trailing = lines[lines.length - 1] === ''
  const body = trailing ? lines.slice(0, -1) : lines
  if (body.length === 0) return []

  const rows: DiffRow[] = body.map((line, index) => ({
    old: null,
    new: { line: index + 1, text: line.replace(/\r$/, ''), noNewline: !trailing && index === body.length - 1 },
    context: false,
  }))

  return [
    { header: `@@ -0,0 +1,${body.length} @@`, oldStart: 0, oldLines: 0, newStart: 1, newLines: body.length, rows },
  ]
}
