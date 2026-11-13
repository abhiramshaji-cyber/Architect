import { useState } from 'react'
import type { SameBehavior as Found } from '../../../shared/jev/types'
import type { FunctionRow } from '../../../shared/types'
import { useProject } from '../../model/store'
import { jevReady, useJev } from './useJev'

type SameProps = { row: FunctionRow; onPick: (file: string, line: number) => void }

const percent = (value: number) => `${Math.round(value * 100)}%`

function Result({ found, onPick }: { found: Found; onPick: SameProps['onPick'] }) {
  if (found.status !== 'done') return <p className="fn-related-note">{found.reason}</p>
  return (
    <>
      <ul className="fn-related-list">
        {found.matches.map((match) => (
          <li key={`${match.file}:${match.line}`}>
            <button className="fn-related-item" onClick={() => onPick(match.file, match.line)} title={match.io}>
              <span className="fn-related-name">
                {match.name} {percent(match.probability)} {match.structural ? 'structural too' : 'Jev only'}
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
      <p className="fn-related-note">
        {found.matches.length === 0 ? 'No other function was confirmed. ' : ''}
        {found.candidates} checked, {found.rejected} rejected. {found.notes.join(' ')}
      </p>
    </>
  )
}

export default function SameBehavior({ row, onPick }: SameProps) {
  const { currentRoot } = useProject()
  const { state } = useJev(currentRoot)
  const [found, setFound] = useState<Found | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!currentRoot || !jevReady(state)) return null
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
