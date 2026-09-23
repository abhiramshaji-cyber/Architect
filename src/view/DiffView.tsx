import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangedFile, DiffChanges, DiffHunk, DiffRow, DiffSection, FileDiff, GitResult } from '../../shared/types'
import { gitMessage } from '../model/picker'
import { useProject } from '../model/store'
import type { ViewProps } from '../shell/views'

const ROW_PAGE = 400

const SECTIONS: { id: DiffSection; label: string; hint: string }[] = [
  { id: 'branch', label: 'On this branch', hint: 'committed since the merge base' },
  { id: 'staged', label: 'Staged', hint: 'in the index, ready to commit' },
  { id: 'unstaged', label: 'Unstaged', hint: 'in the working tree' },
]

const MARK: Record<ChangedFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechanged: 'T',
  unmerged: 'U',
  untracked: 'N',
}

type Selected = { section: DiffSection; file: ChangedFile }

type Entry = { kind: 'hunk'; header: string } | { kind: 'row'; row: DiffRow }

function flatten(hunks: DiffHunk[]): Entry[] {
  return hunks.flatMap((hunk) => [
    { kind: 'hunk' as const, header: hunk.header },
    ...hunk.rows.map((row) => ({ kind: 'row' as const, row })),
  ])
}

function sameFile(a: Selected | null, section: DiffSection, file: ChangedFile): boolean {
  return a !== null && a.section === section && a.file.path === file.path
}

function headLabel(state: DiffChanges['status'] | null): string {
  if (!state) return 'Changes'
  return state.head.kind === 'branch' ? state.head.branch : state.head.commit.slice(0, 8)
}

function counts(file: ChangedFile): string {
  if (file.binary) return 'binary'
  if (file.added === null || file.removed === null) return file.status === 'untracked' ? 'new' : ''
  return `+${file.added} -${file.removed}`
}

function Files({
  section,
  result,
  selected,
  onSelect,
  onStage,
}: {
  section: DiffSection
  result: GitResult<ChangedFile[]>
  selected: Selected | null
  onSelect: (section: DiffSection, file: ChangedFile) => void
  onStage: ((section: DiffSection, file: ChangedFile) => void) | null
}) {
  if (!result.ok) return <p className="diff-section-note error">{gitMessage(result.error)}</p>
  if (result.value.length === 0) return <p className="diff-section-note">Nothing here</p>

  return (
    <ul className="diff-files">
      {result.value.map((file) => (
        <li key={`${file.status}:${file.from ?? ''}:${file.path}`}>
          <button
            className={sameFile(selected, section, file) ? 'diff-file current' : 'diff-file'}
            onClick={() => onSelect(section, file)}
          >
            <span className={`diff-mark ${file.status}`}>{MARK[file.status]}</span>
            <span className="diff-file-path">
              {file.from !== null && file.from !== file.path && <span className="diff-file-from">{file.from} → </span>}
              {file.path}
            </span>
            <span className="diff-file-counts">{counts(file)}</span>
          </button>
          {onStage && (
            <button className="ghost diff-stage" onClick={() => onStage(section, file)}>
              {section === 'staged' ? 'Unstage' : 'Stage'}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

function Rows({ entries, shown }: { entries: Entry[]; shown: number }) {
  return (
    <div className="diff-grid">
      {entries.slice(0, shown).map((entry, index) =>
        entry.kind === 'hunk' ? (
          <div className="diff-hunk" key={index}>
            {entry.header}
          </div>
        ) : (
          <div className="diff-pair" key={index}>
            <span className="diff-no">{entry.row.old?.line ?? ''}</span>
            <span className={entry.row.old ? (entry.row.context ? 'diff-cell' : 'diff-cell del') : 'diff-cell blank'}>
              {entry.row.old && <span className="diff-sign">{entry.row.context ? ' ' : '-'}</span>}
              {entry.row.old?.text}
              {entry.row.old?.noNewline && <span className="diff-eof"> no newline at end of file</span>}
            </span>
            <span className="diff-no">{entry.row.new?.line ?? ''}</span>
            <span className={entry.row.new ? (entry.row.context ? 'diff-cell' : 'diff-cell add') : 'diff-cell blank'}>
              {entry.row.new && <span className="diff-sign">{entry.row.context ? ' ' : '+'}</span>}
              {entry.row.new?.text}
              {entry.row.new?.noNewline && <span className="diff-eof"> no newline at end of file</span>}
            </span>
          </div>
        ),
      )}
    </div>
  )
}

export default function DiffView(_props: ViewProps) {
  const { currentRoot } = useProject()
  const [changes, setChanges] = useState<GitResult<DiffChanges> | null>(null)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [diff, setDiff] = useState<GitResult<FileDiff> | null>(null)
  const [shown, setShown] = useState(ROW_PAGE)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const reload = useCallback(() => {
    if (!currentRoot) return
    setBusy(true)
    window.architect.gitChanges(currentRoot).then((result) => {
      setChanges(result)
      setBusy(false)
    })
  }, [currentRoot])

  useEffect(() => {
    setChanges(null)
    setSelected(null)
    setDiff(null)
    reload()
  }, [reload])

  const load = useCallback(
    (full: boolean) => {
      if (!currentRoot || !selected) return
      setDiff(null)
      setShown(ROW_PAGE)
      window.architect.gitFileDiff(currentRoot, selected.section, selected.file, full).then(setDiff)
    },
    [currentRoot, selected],
  )

  useEffect(() => {
    load(false)
  }, [load])

  const restage = useCallback(
    async (section: DiffSection, file: ChangedFile) => {
      if (!currentRoot) return
      const done =
        section === 'staged'
          ? await window.architect.gitUnstageFile(currentRoot, file)
          : await window.architect.gitStageFile(currentRoot, file)
      setMessage(done.ok ? null : gitMessage(done.error))
      if (done.ok) reload()
    },
    [currentRoot, reload],
  )

  const entries = useMemo(() => (diff?.ok ? flatten(diff.value.hunks) : []), [diff])

  if (!currentRoot) return <div className="empty-state">Select a project to see what changed</div>

  const state = changes?.ok ? changes.value.status : null
  const note = changes && !changes.ok ? gitMessage(changes.error) : message

  return (
    <div className="diff-layout">
      <div className="diff-list">
        <header className="diff-header">
          <h2>{headLabel(state)}</h2>
          {state && (
            <p className="diff-track">
              {state.upstream ? `${state.upstream} · ${state.ahead} ahead, ${state.behind} behind` : 'no upstream'}
              {state.head.kind === 'detached' && ' · detached HEAD'}
            </p>
          )}
          <button className="ghost" onClick={reload} disabled={busy}>
            {busy ? 'Reading…' : 'Refresh'}
          </button>
          {note && <p className="diff-section-note error">{note}</p>}
        </header>

        {changes?.ok &&
          SECTIONS.map((section) => (
            <section className="diff-section" key={section.id}>
              <h3>
                {section.label} <span className="diff-section-hint">{section.hint}</span>
              </h3>
              <Files
                section={section.id}
                result={changes.value[section.id]}
                selected={selected}
                onSelect={(id, file) => setSelected({ section: id, file })}
                onStage={section.id === 'branch' ? null : restage}
              />
            </section>
          ))}
      </div>

      <div className="diff-pane">
        {!selected && <div className="empty-state">Pick a file to read its diff</div>}
        {selected && diff === null && <div className="empty-state">Reading the diff…</div>}
        {diff && !diff.ok && <div className="empty-state">{gitMessage(diff.error)}</div>}
        {diff?.ok && diff.value.binary && <div className="empty-state">{diff.value.path} is binary</div>}
        {diff?.ok && diff.value.oversize && (
          <div className="empty-state">
            <p>
              This diff is {Math.round(diff.value.bytes / 1024)} KB. Rendering it will be slow.
            </p>
            <button className="primary" onClick={() => load(true)}>
              Load it anyway
            </button>
          </div>
        )}
        {diff?.ok && !diff.value.binary && !diff.value.oversize && entries.length === 0 && (
          <div className="empty-state">No line changes in {diff.value.path}</div>
        )}
        {entries.length > 0 && (
          <>
            <Rows entries={entries} shown={shown} />
            {entries.length > shown && (
              <button className="ghost diff-more" onClick={() => setShown(shown + ROW_PAGE)}>
                Show {Math.min(ROW_PAGE, entries.length - shown)} more of {entries.length} rows
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
