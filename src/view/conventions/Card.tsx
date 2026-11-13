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
  const add = () => {
    if (!rule || (impact?.loosens.length && !window.confirm(`${rule} loosens ${impact.loosens.join(', ')} for the paths it covers. Add it anyway?`))) return
    void onPromote(rule).then(setAdded)
  }

  return (
    <li className="cv-card">
      <p className="cv-title">
        <span className={ai ? 'cyber-badge cyber-badge--sm cyber-badge--yellow' : 'cyber-badge cyber-badge--sm cyber-badge--chrome'}>{ai ? 'AI suggestion' : 'Measured'}</span>
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
            {impact.loosens.length > 0 && `, and loosens ${plural(impact.loosens.length, 'rule')} in force`}
          </span>
          <button className="cyber-btn cyber-btn--sm cyber-btn--ghost" disabled={added} onClick={add}>
            {added ? 'Added to Rules' : impact.loosens.length > 0 ? 'Add and loosen' : 'Add to Rules'}
          </button>
        </div>
      )}
      {impact && <Violations label="Would flag" found={impact.flags} />}
      {impact && <Violations label="Would lift" found={impact.clears} />}
      {impact && impact.loosens.length > 0 && (
        <details className="cv-evidence">
          <summary>Loosens</summary>
          <ul>
            {impact.loosens.map((line) => (
              <li key={line}>
                <code>{line}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
})
