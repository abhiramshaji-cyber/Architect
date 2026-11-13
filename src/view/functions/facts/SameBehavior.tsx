import { useState } from 'react'
import { percent } from '../../../../shared/text/percent'
import type { CloneMatch, SameBehavior as Found } from '../../../../shared/clones/types'
import type { FunctionRow } from '../../../../shared/types'
import { useProject } from '../../../model/store'

type SameProps = { row: FunctionRow; onPick: (file: string, line: number) => void }

function kindOf(match: CloneMatch): string {
  const kind = match.clone === 'exact' ? 'exact clone' : match.clone === 'near' ? `near clone ${percent(match.similarity)}` : `structural ${percent(match.similarity)}`
  return match.clone !== null && match.structural ? `${kind}, structural too` : kind
}

function Result({ found, onPick }: { found: Found; onPick: SameProps['onPick'] }) {
  if (found.status !== 'done') return <p className="fn-related-note">{found.reason}</p>
  return (
    <>
      <p className="fn-related-title">Same behavior, {found.matches.length === 1 ? '1 other function' : `${found.matches.length} other functions`}</p>
      <ul className="fn-related-list">
        {found.matches.map((match) => (
          <li key={`${match.file}:${match.line}`}>
            <button className="fn-related-item" onClick={() => onPick(match.file, match.line)}>
              <span className="fn-related-name">
                {match.name} {kindOf(match)}
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
        {found.tokens < found.least ? `Too short to compare by shape (${found.tokens} tokens, ${found.least} needed). ` : ''}
        {found.matches.length === 0 ? 'No other function has the same or a near shape. ' : ''}
        Compared locally by the shape of each body, names, types and comments ignored.
      </p>
    </>
  )
}

export default function SameBehavior({ row, onPick }: SameProps) {
  const { currentRoot } = useProject()
  const [found, setFound] = useState<Found | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!currentRoot) return null
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
    <aside className="fn-related fn-same" aria-label={`Same behavior as ${row.name}`}>
      <button className="cyber-btn cyber-btn--sm cyber-btn--ghost" disabled={busy} onClick={ask}>
        {busy ? 'Comparing…' : 'Same behavior elsewhere'}
      </button>
      {error && <p className="fn-related-note">{error}</p>}
      {found && <Result found={found} onPick={onPick} />}
    </aside>
  )
}
