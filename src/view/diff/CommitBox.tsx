import { useState } from 'react'
import type { GitStatus } from '../../../shared/types'
import { draftMessage, gitMessage } from '../../model/picker'
import Icon from '../Icon'
import { useWork } from './work'

export function CommitBox({
  root,
  state,
  subset,
  reload,
}: {
  root: string
  state: GitStatus
  subset: boolean
  reload: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [details, setDetails] = useState(false)
  const { busy, note, act } = useWork<'write' | 'commit'>()

  async function stageAllUnlessChosen(): Promise<string | null> {
    if (state.staged > 0) return null
    const staged = await window.architect.gitStageAll(root)
    if (!staged.ok) return gitMessage(staged.error)
    reload()
    return null
  }

  const write = () =>
    act('write', async () => {
      const failed = await stageAllUnlessChosen()
      if (failed) return failed

      const drafted = await window.architect.draftCommitMessage(root)
      if (!drafted.ok) return draftMessage(drafted.error)

      setTitle(drafted.value.title)
      setDescription(drafted.value.description)
      setDetails(drafted.value.description.trim() !== '')
      return null
    })

  const commit = () =>
    act('commit', async () => {
      const failed = await stageAllUnlessChosen()
      if (failed) return failed

      const done = await window.architect.gitCommit(root, title, description)
      if (!done.ok) return gitMessage(done.error)

      setTitle('')
      setDescription('')
      setDetails(false)
      reload()
      return `Committed ${done.value.commit.slice(0, 8)}`
    })

  const empty = title.trim() === ''
  const primary = empty ? write : commit
  const label =
    busy === 'write'
      ? 'Writing…'
      : busy === 'commit'
        ? 'Committing…'
        : empty
          ? 'Write message'
          : subset
            ? `Commit ${state.staged} staged`
            : 'Commit'

  return (
    <section className="commit-box">
      <div className="commit-row">
        <input
          className="commit-title"
          value={title}
          placeholder="Message"
          aria-label="Commit message"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !empty && busy === null) void commit()
          }}
        />
        <button
          className="icon-button"
          aria-label={details ? 'Hide description' : 'Add description'}
          title={details ? 'Hide description' : 'Add description'}
          aria-pressed={details}
          onClick={() => setDetails(!details)}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>

      {details && (
        <textarea
          className="commit-description"
          value={description}
          placeholder="Description"
          rows={4}
          onChange={(event) => setDescription(event.target.value)}
        />
      )}

      <button className="primary" onClick={() => void primary()} disabled={busy !== null || state.conflicted > 0}>
        {label}
      </button>

      {note && <p className="diff-section-note">{note}</p>}
    </section>
  )
}
