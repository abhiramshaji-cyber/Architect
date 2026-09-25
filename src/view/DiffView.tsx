import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ChangedFile,
  DiffChanges,
  DiffHunk,
  DiffRow,
  DiffSection,
  FileDiff,
  GitResult,
  GitStatus,
  GithubPull,
} from '../../shared/types'
import { draftMessage, githubMessage, gitMessage } from '../model/picker'
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

type Work = 'autofill' | 'commit' | 'push' | 'pull' | 'pr-draft' | 'pr-create'

type Target = { base: string; branch: string } | null

function upstreamNote(state: GitStatus): string {
  const tracking = state.upstream
    ? `${state.upstream} \u00b7 ${state.ahead} ahead, ${state.behind} behind`
    : 'no upstream'
  return state.head.kind === 'detached' ? `${tracking} \u00b7 detached HEAD` : tracking
}

function CommitBox({
  state,
  title,
  description,
  busy,
  note,
  onTitle,
  onDescription,
  onAutofill,
  onCommit,
  onPush,
  onPull,
}: {
  state: GitStatus
  title: string
  description: string
  busy: Work | null
  note: string | null
  onTitle: (value: string) => void
  onDescription: (value: string) => void
  onAutofill: () => void
  onCommit: () => void
  onPush: () => void
  onPull: () => void
}) {
  const detached = state.head.kind === 'detached'
  const nothingStaged = state.staged === 0
  const blocked =
    nothingStaged ? 'Stage a file before you commit it' : title.trim() === '' ? 'A commit needs a summary' : null

  return (
    <section className="commit-box">
      <h3>Commit</h3>

      <input
        className="commit-title"
        value={title}
        placeholder="Summary"
        onChange={(event) => onTitle(event.target.value)}
      />
      <textarea
        className="commit-description"
        value={description}
        placeholder="Description"
        rows={4}
        onChange={(event) => onDescription(event.target.value)}
      />

      <div className="commit-actions">
        <button className="ghost" onClick={onAutofill} disabled={busy !== null || nothingStaged}>
          {busy === 'autofill' ? 'Asking Claude\u2026' : 'Autofill'}
        </button>
        <button className="primary" onClick={onCommit} disabled={busy !== null || blocked !== null}>
          {busy === 'commit' ? 'Committing\u2026' : 'Commit'}
        </button>
        <button className="ghost" onClick={onPush} disabled={busy !== null || detached}>
          {busy === 'push' ? 'Pushing\u2026' : state.upstream === null ? 'Publish branch' : 'Push'}
        </button>
        <button className="ghost" onClick={onPull} disabled={busy !== null || detached || state.upstream === null}>
          {busy === 'pull' ? 'Pulling\u2026' : 'Pull'}
        </button>
      </div>

      {blocked && <p className="diff-section-note">{blocked}</p>}
      {note && <p className="diff-section-note">{note}</p>}
    </section>
  )
}

function PullRequestBox({
  target,
  state,
  ahead,
  existing,
  title,
  body,
  busy,
  note,
  onTitle,
  onBody,
  onDraft,
  onCreate,
}: {
  target: Target
  state: GitStatus
  ahead: boolean
  existing: GithubPull | null
  title: string
  body: string
  busy: Work | null
  note: string | null
  onTitle: (value: string) => void
  onBody: (value: string) => void
  onDraft: () => void
  onCreate: () => void
}) {
  if (target === null || target.branch === target.base) return null

  const blocked =
    state.upstream === null
      ? `${target.branch} has not been pushed yet, so publish it first`
      : !ahead
        ? `${target.branch} has nothing on it that ${target.base} does not, so there is nothing to open`
        : title.trim() === ''
          ? 'A pull request needs a title'
          : null

  return (
    <section className="commit-box">
      <h3>Pull request</h3>
      <p className="diff-section-note">
        {`${target.branch} \u2192 ${target.base}`}
      </p>

      {existing && (
        <p className="diff-section-note">
          <a href={existing.url} target="_blank" rel="noreferrer">
            #{existing.number} {existing.title}
          </a>
        </p>
      )}

      {!existing && (
        <>
          <input
            className="commit-title"
            value={title}
            placeholder="Title"
            onChange={(event) => onTitle(event.target.value)}
          />
          <textarea
            className="commit-description"
            value={body}
            placeholder="Body"
            rows={8}
            onChange={(event) => onBody(event.target.value)}
          />

          <div className="commit-actions">
            <button className="ghost" onClick={onDraft} disabled={busy !== null || !ahead}>
              {busy === 'pr-draft' ? 'Asking Claude\u2026' : 'Autofill'}
            </button>
            <button className="primary" onClick={onCreate} disabled={busy !== null || blocked !== null}>
              {busy === 'pr-create' ? 'Opening\u2026' : 'Open pull request'}
            </button>
          </div>

          {blocked && <p className="diff-section-note">{blocked}</p>}
        </>
      )}

      {note && <p className="diff-section-note">{note}</p>}
    </section>
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
  const [work, setWork] = useState<Work | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [commitNote, setCommitNote] = useState<string | null>(null)
  const [target, setTarget] = useState<Target>(null)
  const [existing, setExisting] = useState<GithubPull | null>(null)
  const [prTitle, setPrTitle] = useState('')
  const [prBody, setPrBody] = useState('')
  const [prNote, setPrNote] = useState<string | null>(null)

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
    setTarget(null)
    setExisting(null)
    reload()
  }, [reload])

  const head = changes?.ok && changes.value.status.head.kind === 'branch' ? changes.value.status.head.branch : null

  useEffect(() => {
    if (!currentRoot || head === null) return

    let live = true
    void window.architect.gitDefaultBranch(currentRoot).then((base) => {
      if (live) setTarget(base.ok ? { base: base.value.branch, branch: head } : null)
    })
    void window.architect
      .githubPullFor(currentRoot, head)
      .then((found) => {
        if (live) setExisting(found.ok ? found.value : null)
      })
      .catch(() => {})

    return () => {
      live = false
    }
  }, [currentRoot, head])

  const act = useCallback(
    async (kind: Work, run: () => Promise<string | null>, tell: (note: string | null) => void) => {
      setWork(kind)
      try {
        tell(await run())
      } catch (err) {
        tell(err instanceof Error ? err.message : String(err))
      } finally {
        setWork(null)
      }
    },
    [],
  )

  const autofill = useCallback(() => {
    if (!currentRoot) return
    void act(
      'autofill',
      async () => {
        const drafted = await window.architect.draftCommitMessage(currentRoot)
        if (!drafted.ok) return draftMessage(drafted.error)

        setTitle(drafted.value.title)
        setDescription(drafted.value.description)
        return 'Claude wrote a message. Read it, change it, then commit.'
      },
      setCommitNote,
    )
  }, [act, currentRoot])

  const doCommit = useCallback(() => {
    if (!currentRoot) return
    void act(
      'commit',
      async () => {
        const done = await window.architect.gitCommit(currentRoot, title, description)
        if (!done.ok) return gitMessage(done.error)

        setTitle('')
        setDescription('')
        reload()
        return `Committed ${done.value.commit.slice(0, 8)}`
      },
      setCommitNote,
    )
  }, [act, currentRoot, description, reload, title])

  const doPush = useCallback(() => {
    if (!currentRoot) return
    void act(
      'push',
      async () => {
        const done = await window.architect.gitPush(currentRoot)
        if (!done.ok) return gitMessage(done.error)

        reload()
        return done.value.setUpstream
          ? `Published ${done.value.branch} to ${done.value.remote}`
          : `Pushed ${done.value.branch} to ${done.value.remote}`
      },
      setCommitNote,
    )
  }, [act, currentRoot, reload])

  const doPull = useCallback(() => {
    if (!currentRoot) return
    void act(
      'pull',
      async () => {
        const done = await window.architect.gitPull(currentRoot)
        if (!done.ok) return gitMessage(done.error)

        reload()
        return done.value.changed ? `Pulled ${done.value.branch} from ${done.value.remote}` : 'Already up to date'
      },
      setCommitNote,
    )
  }, [act, currentRoot, reload])

  const draftPr = useCallback(() => {
    if (!currentRoot) return
    void act(
      'pr-draft',
      async () => {
        const drafted = await window.architect.draftPullRequest(currentRoot)
        if (!drafted.ok) return draftMessage(drafted.error)

        setPrTitle(drafted.value.title)
        setPrBody(drafted.value.body)
        return 'Claude wrote it from your pr instructions. Read it, change it, then open it.'
      },
      setPrNote,
    )
  }, [act, currentRoot])

  const createPr = useCallback(() => {
    if (!currentRoot || target === null) return
    void act(
      'pr-create',
      async () => {
        const opened = await window.architect.githubCreatePull(
          currentRoot,
          target.base,
          target.branch,
          prTitle,
          prBody,
        )
        if (!opened.ok) return githubMessage(opened.error)

        setExisting(opened.value)
        setPrTitle('')
        setPrBody('')
        return `Opened #${opened.value.number}`
      },
      setPrNote,
    )
  }, [act, currentRoot, prBody, prTitle, target])

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
            <p className="diff-track">{upstreamNote(state)}</p>
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

        {state && (
          <CommitBox
            state={state}
            title={title}
            description={description}
            busy={work}
            note={commitNote}
            onTitle={setTitle}
            onDescription={setDescription}
            onAutofill={autofill}
            onCommit={doCommit}
            onPush={doPush}
            onPull={doPull}
          />
        )}

        {state && (
          <PullRequestBox
            target={target}
            state={state}
            ahead={changes?.ok === true && changes.value.branch.ok && changes.value.branch.value.length > 0}
            existing={existing}
            title={prTitle}
            body={prBody}
            busy={work}
            note={prNote}
            onTitle={setPrTitle}
            onBody={setPrBody}
            onDraft={draftPr}
            onCreate={createPr}
          />
        )}
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
