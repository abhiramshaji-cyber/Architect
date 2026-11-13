import { memo } from 'react'
import { percent } from '../../../shared/text/percent'
import type { CoChange, Coupling, CouplingPair } from '../../../shared/types'
import { plural } from '../functions/Mark'

type PairProps = { pair: CouplingPair; coupling: Coupling; onOpen: (file: string) => void }

const day = (at: number) => new Date(at).toISOString().slice(0, 10)

function share(change: CoChange, at: number, unit: string): string {
  const own = change.changes[at] ?? 0
  return `${change.shared.length} of its ${plural(own, unit)}${own > 0 ? ` (${percent(change.shared.length / own)})` : ''}`
}

export default memo(function Pair({ pair, coupling, onOpen }: PairProps) {
  const { commits, sessions } = pair
  return (
    <li className="cp-pair">
      <p className="cp-summary">
        {plural(commits.shared.length, 'shared commit')}, confidence {percent(commits.confidence)} · {plural(sessions.shared.length, 'shared session')}, confidence{' '}
        {percent(sessions.confidence)}
      </p>
      {pair.files.map((file, at) => (
        <div key={file} className="cp-file">
          <button onClick={() => onOpen(file)}>{file}</button>
          <span className="cp-ratio">
            {share(commits, at, 'commit')} · {share(sessions, at, 'session')}
          </span>
        </div>
      ))}
      <details className="cp-evidence">
        <summary>Evidence</summary>
        <ul>
          {commits.shared.map((sha) => {
            const commit = coupling.commits[sha]
            return (
              <li key={sha}>
                <code>{commit?.short ?? sha.slice(0, 7)}</code> {commit ? `${day(commit.at)} ${commit.subject}` : ''}
              </li>
            )
          })}
          {sessions.shared.map((id) => {
            const at = coupling.sessions[id]
            return (
              <li key={id}>
                session <code>{id.slice(0, 8)}</code> {at === undefined ? '' : day(at)}
              </li>
            )
          })}
        </ul>
      </details>
    </li>
  )
})
