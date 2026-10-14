import { useEffect, useMemo, useState } from 'react'
import type { Commit, HistoryEntry } from '../../../shared/types'
import { byCommit } from '../../model/live/commits'
import { ago, byMoment, collapse, rowOf, targetOf, type Target } from '../../model/live/history'
import { useProject } from '../../model/store'
import Icon from '../Icon'

const TICK_MS = 30_000
const COMMITS_POLL_MS = 3000

function useCommits(root: string | null, since: number | undefined): Commit[] | null {
  const [found, setFound] = useState<{ root: string; commits: Commit[] | null } | null>(null)

  useEffect(() => {
    if (!root || since === undefined) return

    let live = true
    const read = () => {
      if (document.visibilityState === 'hidden') return
      window.architect.gitCommits(root, since).then(
        (result) => live && setFound({ root, commits: result.ok ? result.value : null }),
        () => live && setFound({ root, commits: null }),
      )
    }

    read()
    const timer = setInterval(read, COMMITS_POLL_MS)
    window.addEventListener('focus', read)
    document.addEventListener('visibilitychange', read)
    return () => {
      live = false
      clearInterval(timer)
      window.removeEventListener('focus', read)
      document.removeEventListener('visibilitychange', read)
    }
  }, [root, since])

  return found?.root === root ? found.commits : null
}

function Rows({ entries, opened, onPick }: { entries: HistoryEntry[]; opened: number; onPick: (target: Target) => void }) {
  return (
    <ul>
      {collapse(entries).map(({ entry, change, name, parent, count }) => {
        const target = targetOf(entry)
        const full = parent ? `${parent}/${name}` : name
        return (
          <li key={entry.id} className={entry.at >= opened ? 'history-entry arriving' : 'history-entry'}>
            <button
              className="history-item"
              onClick={target ? () => onPick(target) : undefined}
              disabled={!target}
              title={`${change} ${full}`}
              aria-label={`${entry.source === 'contract' ? 'Contract' : 'Code'} ${change} ${full}`}
            >
              <span className={`history-source ${change}`}>
                <Icon name={entry.source === 'contract' ? 'graph' : 'file'} size={14} />
              </span>
              <span className="history-name">{name}</span>
              {parent && (
                <span className="history-parent">
                  <bdi>{parent}</bdi>
                </span>
              )}
              {count > 1 && <span className="history-count">×{count}</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export default function HistoryPanel({ onPick }: { onPick: (target: Target) => void }) {
  const { history, currentRoot } = useProject()
  const [now, setNow] = useState(Date.now)
  const [opened] = useState(Date.now)
  const shown = useMemo(() => history.filter((e) => rowOf(e) !== null), [history])
  const commits = useCommits(currentRoot, shown.at(-1)?.at)
  const moments = useMemo(() => (commits ? [] : byMoment(shown, now)), [commits, shown, now])
  const groups = useMemo(() => (commits ? byCommit(shown, commits) : []), [commits, shown])

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [history])

  return (
    <section className="rail-section history">
      <h2>History</h2>
      {shown.length === 0 ? (
        <p className="history-quiet">Quiet</p>
      ) : (
        <ol className="history-list">
          {moments.map((moment) => (
            <li key={moment.label} className="history-group">
              <time className="history-time" dateTime={new Date(moment.at).toISOString()}>
                {moment.label}
              </time>
              <Rows entries={moment.entries} opened={opened} onPick={onPick} />
            </li>
          ))}
          {groups.map(({ key, commit, at, entries }) => (
            <li key={key} className={commit ? 'history-group history-commit' : 'history-group history-commit pending'}>
              <header className="history-commit-head" title={commit ? `${commit.short} ${commit.subject}` : undefined}>
                {commit && <code className="history-sha">{commit.short}</code>}
                <span className="history-subject">{commit ? commit.subject : 'Uncommitted'}</span>
                <time className="history-ago" dateTime={new Date(at).toISOString()}>
                  {ago(at, now)}
                </time>
              </header>
              <Rows entries={entries} opened={opened} onPick={onPick} />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
