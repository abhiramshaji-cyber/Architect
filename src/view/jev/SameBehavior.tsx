import { useState } from 'react'
import { CONFIRMED, POSSIBLE, type BehaviorMatch, type SameBehavior as Found } from '../../../shared/jev/types'
import type { FunctionRow } from '../../../shared/types'
import { useProject } from '../../model/store'
import { useJev } from './useJev'

type SameProps = { row: FunctionRow; onPick: (file: string, line: number) => void }

const percent = (value: number) => `${Math.round(value * 100)}%`

function Matches({ matches, onPick }: { matches: BehaviorMatch[]; onPick: SameProps['onPick'] }) {
  return (
    <ul className="fn-related-list">
      {matches.map((match) => (
        <li key={`${match.file}:${match.line}`}>
          <button className="fn-related-item" onClick={() => onPick(match.file, match.line)} title={match.io}>
            <span className="fn-related-name">
              {match.name} {percent(match.probability)} {match.structural ? 'structural too' : 'Jev only'}
              {match.via ? ` via ${match.via}` : ''}
              {match.responsibility ? ` · ${match.responsibility}` : ''}
            </span>
            <span className="fn-related-file">
              <bdi>
                {match.file}:{match.line}
              </bdi>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Result({ found, onPick }: { found: Found; onPick: SameProps['onPick'] }) {
  if (found.status !== 'done') return <p className="fn-related-note">{found.reason}</p>
  return (
    <>
      <p className="fn-related-title">
        Same behavior group, {found.matches.length + 1} functions{found.responsibility ? ` · ${found.name} in ${found.responsibility}` : ''}
      </p>
      <Matches matches={found.matches} onPick={onPick} />
      {found.possible.length > 0 && (
        <>
          <p className="fn-related-title">Possible, not confirmed ({percent(POSSIBLE)} to {percent(CONFIRMED)})</p>
          <Matches matches={found.possible} onPick={onPick} />
        </>
      )}
      <p className="fn-related-note">
        {found.matches.length === 0 ? 'No other function was confirmed. ' : ''}
        {found.candidates} checked, {found.rejected} rejected. {found.notes.join(' ')}
      </p>
    </>
  )
}

export default function SameBehavior({ row, onPick }: SameProps) {
  const { currentRoot } = useProject()
  const { ready } = useJev(currentRoot)
  const [found, setFound] = useState<Found | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!currentRoot || !ready) return null
  const ask = () => {
    setBusy(true)
    setError(null)
    window.architect.sameBehavior(currentRoot, row.file, row.name).then(
      (answer) => {
        setFound(answer)
        setBusy(false)
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setBusy(false)
      },
    )
  }

  return (
    <aside className="fn-related" aria-label={`Same behavior as ${row.name}`}>
      <button className="cyber-btn cyber-btn--sm cyber-btn--ghost" disabled={busy} onClick={ask}>
        {busy ? 'Asking Jev…' : 'Same behavior elsewhere'}
      </button>
      {error && <p className="fn-related-note">{error}</p>}
      {found && <Result found={found} onPick={onPick} />}
    </aside>
  )
}
