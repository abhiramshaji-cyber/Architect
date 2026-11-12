import { memo, useState } from 'react'
import type { Convention, RuleViolation } from '../../../shared/types'
import { plural } from '../functions/Mark'

type CardProps = { convention: Convention; onOpen: (file: string) => void; onPromote: (rule: string) => Promise<boolean> }

function Violations({ label, found }: { label: string; found: RuleViolation[] }) {
  if (found.length === 0) return null
  return (
    <details className="cv-evidence">
      <summary>{label}</summary>
      <ul>
        {found.map((violation) => (
          <li key={violation.key}>
            <code>{violation.path}</code> {violation.message}
          </li>
        ))}
      </ul>
    </details>
  )
}

export default memo(function Card({ convention, onOpen, onPromote }: CardProps) {
  const [added, setAdded] = useState(false)
  const { impact, rule } = convention
  const ai = convention.source === 'ai'

  return (
    <li className="cv-card">
      <p className="cv-title">
        <span className={ai ? 'cv-badge ai' : 'cv-badge'}>{ai ? 'AI suggestion' : 'Measured'}</span>
        {convention.title}
      </p>
      {convention.detail && <p className="cv-detail">{convention.detail}</p>}
      <div className="cv-files">
        {convention.files.map((file) => (
          <button key={file} onClick={() => onOpen(file)}>
            {file}
          </button>
        ))}
      </div>
      {convention.unusable && <p className="cv-detail">Its rule could not be read, so it cannot be added: {convention.unusable}</p>}
      {rule && impact && (
        <div className="cv-rule">
          <code>{rule}</code>
          <span className="cv-impact">
            {impact.flags.length === 0 ? 'flags nothing today' : `would flag ${plural(impact.flags.length, 'violation')} today`}
            {impact.clears.length > 0 && `, and would lift ${plural(impact.clears.length, 'violation')} in force now`}
          </span>
          <button className="ghost" disabled={added} onClick={() => onPromote(rule).then(setAdded)}>
            {added ? 'Added to Rules' : 'Add to Rules'}
          </button>
        </div>
      )}
      {impact && <Violations label="Would flag" found={impact.flags} />}
      {impact && <Violations label="Would lift" found={impact.clears} />}
    </li>
  )
})
