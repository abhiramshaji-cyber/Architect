import { useEffect, useMemo, useState } from 'react'
import { byMoment, lineOf, targetOf, type Target } from '../../model/live/history'
import { useProject } from '../../model/store'
import Icon from '../Icon'

const TICK_MS = 30_000

export default function HistoryPanel({ onPick }: { onPick: (target: Target) => void }) {
  const { history } = useProject()
  const [now, setNow] = useState(Date.now)
  const [opened] = useState(Date.now)
  const groups = useMemo(() => byMoment(history.filter((e) => lineOf(e) !== ''), now), [history, now])

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [history])

  return (
    <section className="rail-section history">
      <h2>History</h2>
      {groups.length === 0 ? (
        <p className="history-quiet">Quiet</p>
      ) : (
        <ol className="history-list">
          {groups.map((group) => (
            <li key={group.label} className="history-group">
              <time className="history-time" dateTime={new Date(group.at).toISOString()}>
                {group.label}
              </time>
              <ul>
                {group.entries.map((entry) => {
                  const target = targetOf(entry)
                  const line = lineOf(entry)
                  return (
                    <li key={entry.id} className={entry.at >= opened ? 'history-entry arriving' : 'history-entry'}>
                      <button
                        className="history-item"
                        onClick={target ? () => onPick(target) : undefined}
                        disabled={!target}
                        title={line}
                        aria-label={`${entry.source === 'contract' ? 'Contract' : 'Code'} ${line}`}
                      >
                        <span className="history-source">
                          <Icon name={entry.source === 'contract' ? 'graph' : 'file'} size={14} />
                        </span>
                        <span className="history-line">{line}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
