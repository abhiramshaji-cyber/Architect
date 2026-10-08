import { useEffect, useState } from 'react'
import { BROKEN_TEXT, agoText, distanceText, gitMessage, plural, removedText } from '../../model/picker'
import { isDirty, isUnpushed, worktreeLabel, type Skipped } from '../../model/removal'
import type { Stage } from './useRemoval'
import type { BaseDistance, ClaudeWorktree, GitResult } from '../../../shared/types'

type Props = {
  highlight: ClaudeWorktree | undefined
  now: number
  stage: Stage
  onStage: (stage: Stage) => void
  onSurvey: (worktrees: ClaudeWorktree[]) => void
  onRemove: () => void
}

function distanceLine(result: GitResult<BaseDistance> | null): string {
  if (!result) return 'Counting against the default branch…'
  if (!result.ok) return gitMessage(result.error)

  return `${distanceText(result.value)} against ${result.value.base}`
}

function Details({ highlight, now, onSurvey }: { highlight: ClaudeWorktree; now: number; onSurvey: Props['onSurvey'] }) {
  const [distance, setDistance] = useState<GitResult<BaseDistance> | null>(null)

  useEffect(() => {
    setDistance(null)
    if (highlight.broken) return

    let live = true
    window.architect
      .gitDistance(highlight.path)
      .then((result) => {
        if (live) setDistance(result)
      })
      .catch(() => {})

    return () => {
      live = false
    }
  }, [highlight.path, highlight.broken])

  return (
    <>
      <h4>{highlight.name}</h4>
      <p className="goto-hint">{highlight.path}</p>
      <p className="goto-hint">repo: {highlight.repo}</p>
      <p className="goto-hint">branch: {highlight.branch ?? 'detached'}</p>
      {highlight.broken ? (
        <p className="goto-hint">Broken: {BROKEN_TEXT[highlight.broken]}</p>
      ) : (
        <>
          <p className="goto-hint">{distanceLine(distance)}</p>
          <p className="goto-hint">
            {highlight.dirty ? 'uncommitted changes' : 'clean'} · {agoText(highlight.changedAt, now)}
          </p>
        </>
      )}
      <button className="action danger" onClick={() => onSurvey([highlight])}>
        Delete worktree…
      </button>
    </>
  )
}

function Reasons({ rows, title, open }: { rows: Skipped[]; title: string; open: boolean }) {
  if (rows.length === 0) return null

  return (
    <details open={open}>
      <summary className="goto-hint">{title}</summary>
      <ul className="picker-reasons">
        {rows.map((row) => (
          <li key={row.worktree.path}>
            <code>{worktreeLabel(row.worktree)}</code>: {row.reason}
          </li>
        ))}
      </ul>
    </details>
  )
}

export default function Panel({ highlight, now, stage, onStage, onSurvey, onRemove }: Props) {
  if (stage.kind === 'idle') return highlight ? <Details highlight={highlight} now={now} onSurvey={onSurvey} /> : null
  if (stage.kind === 'surveying') return <p className="goto-hint">Checking {plural(stage.total, 'worktree')}…</p>
  if (stage.kind === 'removing') return <p className="goto-hint">Removing {stage.done} of {stage.total}…</p>

  if (stage.kind === 'done') {
    const kept = stage.removed.filter(isUnpushed).length
    return (
      <>
        <h4>Removed {stage.removed.length} of {stage.total}</h4>
        {kept > 0 && <p className="goto-hint">{kept} kept their branch, since it holds commits that are on no remote</p>}
        {stage.left > 0 && <p className="goto-hint">{stage.left} with uncommitted changes left alone</p>}
        {stage.failed.map((row) => (
          <p key={row.worktree.path} className="picker-error">
            {worktreeLabel(row.worktree)}: {row.reason}
          </p>
        ))}
        <Reasons rows={stage.skipped} title={`${stage.skipped.length} skipped`} open={stage.total === 0} />
        {stage.removed.length > 0 && (
          <details>
            <summary className="goto-hint">What was removed</summary>
            <ul className="picker-reasons">
              {stage.removed.map((row) => (
                <li key={row.worktree.path}>{removedText(row.worktree, row.removed)}</li>
              ))}
            </ul>
          </details>
        )}
        <button className="action" onClick={() => onStage({ kind: 'idle' })}>
          Done
        </button>
      </>
    )
  }

  const { review, force, branches } = stage
  const going = review.ready.filter((row) => force || !isDirty(row))
  const dirty = review.ready.filter(isDirty).length
  const unpushed = going.filter(isUnpushed).length
  const pruned = going.filter((row) => row.plan.kind === 'prune').length
  const trashed = going.filter((row) => row.plan.kind === 'trash').length

  return (
    <>
      <h4>Delete {plural(going.length, 'worktree')}</h4>
      {going.length === 1 && going[0] && <p className="goto-hint">{worktreeLabel(going[0].worktree)}</p>}
      <Reasons rows={review.skipped} title={`${review.skipped.length} skipped`} open={review.ready.length === 0} />
      {dirty > 0 && <p className="picker-error">{dirty} with uncommitted changes</p>}
      {unpushed > 0 && (
        <p className="goto-hint">{unpushed} with unpushed commits: only the worktree goes, the branch stays because git branch -d refuses unmerged branches</p>
      )}
      {pruned > 0 && <p className="goto-hint">{pruned} already gone from disk: git worktree prune drops the stale entry</p>}
      {trashed > 0 && <p className="goto-hint">{trashed} unknown to git: the folder moves to the Trash</p>}

      {dirty > 0 && (
        <label className="picker-check">
          <input type="checkbox" checked={force} onChange={(event) => onStage({ ...stage, force: event.target.checked })} />
          Also remove the {dirty} with uncommitted changes (force). Those changes are deleted for good.
        </label>
      )}
      <label className="picker-check">
        <input type="checkbox" checked={branches} onChange={(event) => onStage({ ...stage, branches: event.target.checked })} />
        Delete their branches when merged
      </label>

      {going.length > 1 && (
        <details>
          <summary className="goto-hint">Show the {going.length}</summary>
          <ul className="picker-reasons">
            {going.map((row) => (
              <li key={row.worktree.path}>{worktreeLabel(row.worktree)}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="picker-actions">
        <button className="action danger" onClick={onRemove} disabled={going.length === 0}>
          Delete {going.length}
        </button>
        <button className="action" onClick={() => onStage({ kind: 'idle' })}>
          Cancel
        </button>
      </div>
    </>
  )
}
