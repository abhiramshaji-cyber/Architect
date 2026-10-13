import type { DiffHunk, DiffRow } from '../../shared/types'

type Side = 'old' | 'new'

type Entry = { kind: 'hunk'; start: Record<Side, number | null> } | { kind: 'row'; row: DiffRow }

export function flatten(hunks: DiffHunk[]): Entry[] {
  return hunks.flatMap((hunk) => [
    {
      kind: 'hunk' as const,
      start: { old: hunk.oldLines > 0 ? hunk.oldStart : null, new: hunk.newLines > 0 ? hunk.newStart : null },
    },
    ...hunk.rows.map((row) => ({ kind: 'row' as const, row })),
  ])
}

const SIGN = { add: '+', del: '-', same: '', blank: '' }

function Line({ entry, side }: { entry: Entry; side: Side }) {
  if (entry.kind === 'hunk') {
    const start = entry.start[side]
    return <div className="diff-hunk">{start !== null && <span>Line {start}</span>}</div>
  }

  const cell = entry.row[side]
  const kind = cell === null ? 'blank' : entry.row.context ? 'same' : side === 'old' ? 'del' : 'add'

  return (
    <div className={`diff-line ${kind}`}>
      <span className="diff-no">{cell?.line}</span>
      <span className="diff-sign">{SIGN[kind]}</span>
      <span className="diff-code">
        {cell?.text}
        {cell?.noNewline && <span className="diff-eof">no newline at end of file</span>}
      </span>
    </div>
  )
}

export function SplitDiff({ entries, shown }: { entries: Entry[]; shown: number }) {
  const visible = entries.slice(0, shown)

  return (
    <div className="diff-sides">
      {(['old', 'new'] as const).map((side) => (
        <div className="diff-side" key={side}>
          <div className="diff-lines">
            {visible.map((entry, index) => (
              <Line entry={entry} side={side} key={index} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
