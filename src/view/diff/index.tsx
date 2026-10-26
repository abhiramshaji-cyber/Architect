import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangedFile, DiffChanges, FileDiff, GitResult } from '../../../shared/types'
import { gitMessage } from '../../model/picker'
import { useProject } from '../../model/store'
import type { ViewProps } from '../../shell/views'
import Icon from '../Icon'
import { flatten, SplitDiff } from '../SplitDiff'
import { BranchBox, SyncButton } from './BranchBox'
import { CommitBox } from './CommitBox'
import { Files, type Selected, type Staging } from './Files'

const ROW_PAGE = 400

function headLabel(state: DiffChanges['status'] | null): string {
  if (!state) return 'Changes'
  return state.head.kind === 'branch' ? state.head.branch : state.head.commit.slice(0, 8)
}

function paths(result: GitResult<ChangedFile[]>): Set<string> {
  return new Set(result.ok ? result.value.map((file) => file.path) : [])
}

export default function DiffView(_props: ViewProps) {
  const { currentRoot } = useProject()
  const [changes, setChanges] = useState<GitResult<DiffChanges> | null>(null)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [diff, setDiff] = useState<GitResult<FileDiff> | null>(null)
  const [shown, setShown] = useState(ROW_PAGE)
  const [reading, setReading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const reload = useCallback(() => {
    if (!currentRoot) return
    setReading(true)
    window.architect.gitChanges(currentRoot).then((result) => {
      setChanges(result)
      setReading(false)
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
    async (file: ChangedFile, staged: boolean) => {
      if (!currentRoot) return
      const done = staged
        ? await window.architect.gitUnstageFile(currentRoot, file)
        : await window.architect.gitStageFile(currentRoot, file)
      setMessage(done.ok ? null : gitMessage(done.error))
      if (done.ok) reload()
    },
    [currentRoot, reload],
  )

  const value = changes?.ok ? changes.value : null
  const staging = useMemo(() => {
    const staged = value ? paths(value.staged) : new Set<string>()
    const unstaged = value ? paths(value.unstaged) : new Set<string>()
    return (file: ChangedFile): Staging =>
      !staged.has(file.path) ? null : unstaged.has(file.path) ? 'partial' : 'staged'
  }, [value])

  const entries = useMemo(() => (diff?.ok ? flatten(diff.value.hunks) : []), [diff])

  if (!currentRoot) return null

  const state = value?.status ?? null
  const note = changes && !changes.ok ? gitMessage(changes.error) : message
  const local = value?.local.ok ? value.local.value : []
  const branch = value?.branch.ok ? value.branch.value : []
  const commits = branch.length > 0 ? (value?.commits ?? 0) : 0
  const subset = state !== null && state.staged > 0 && local.some((file) => staging(file) !== 'staged')

  return (
    <div className="diff-layout">
      <div className="diff-list">
        <header className="diff-header">
          <h2>{headLabel(state)}</h2>
          {state && <SyncButton root={currentRoot} state={state} commits={commits} reload={reload} />}
          <button className="icon-button" onClick={reload} disabled={reading} aria-label="Refresh" title="Refresh">
            <Icon name="refresh" size={14} />
          </button>
          {note && <p className="diff-section-note error">{note}</p>}
          {value && !value.local.ok && <p className="diff-section-note error">{gitMessage(value.local.error)}</p>}
        </header>

        {value && state && local.length === 0 && commits === 0 && <p className="diff-empty">No changes</p>}

        {value && state && local.length > 0 && (
          <>
            <section className="diff-section">
              <Files
                section="local"
                files={local}
                prefix={value.prefix}
                selected={selected}
                staging={staging}
                tags={subset}
                onSelect={setSelected}
                onStage={restage}
              />
            </section>
            <CommitBox root={currentRoot} state={state} subset={subset} reload={reload} />
          </>
        )}

        {value && state && commits > 0 && (
          <BranchBox
            root={currentRoot}
            state={state}
            commits={commits}
            files={branch}
            prefix={value.prefix}
            selected={selected}
            onSelect={setSelected}
          />
        )}
      </div>

      <div className="diff-pane">
        {!selected && <div className="empty-state">No file selected</div>}
        {selected && diff === null && <div className="empty-state">Loading…</div>}
        {diff && !diff.ok && <div className="empty-state">{gitMessage(diff.error)}</div>}
        {diff?.ok && diff.value.binary && <div className="empty-state">{diff.value.path} is binary</div>}
        {diff?.ok && diff.value.oversize && (
          <div className="empty-state">
            <p>Large diff, {Math.round(diff.value.bytes / 1024)} KB</p>
            <button className="primary" onClick={() => load(true)}>
              Load anyway
            </button>
          </div>
        )}
        {diff?.ok && !diff.value.binary && !diff.value.oversize && entries.length === 0 && (
          <div className="empty-state">No line changes</div>
        )}
        {entries.length > 0 && (
          <>
            <SplitDiff entries={entries} shown={shown} />
            {entries.length > shown && (
              <button className="ghost diff-more" onClick={() => setShown(shown + ROW_PAGE)}>
                Show {Math.min(ROW_PAGE, entries.length - shown)} more
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
