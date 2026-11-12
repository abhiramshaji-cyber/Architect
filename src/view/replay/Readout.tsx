import type { VerdictRecord } from '../../../shared/types'
import { plural } from '../functions/Mark'
import type { Step } from './timeline/steps'
import type { Held } from './timeline/verdicts'

const KINDS: Record<Step['kind'], string> = {
  commit: 'Commit',
  code: 'Code change',
  contract: 'Contract change',
}

export const when = (at: number) => new Date(at).toLocaleString()

export function stepText(step: Step): string {
  return [KINDS[step.kind], step.short, when(step.at)].filter(Boolean).join(' ')
}

export function verdictText({ from, to, file, verdict, stale }: VerdictRecord): string {
  const edge = from !== undefined && to !== undefined ? `${from} -> ${to}` : undefined
  const asked = (verdict.status === 'rule-violation' ? (file ?? edge) : (edge ?? file)) ?? 'change'
  const said = (() => {
    switch (verdict.status) {
      case 'allowed':
        return 'allowed'
      case 'forbidden':
        return `forbidden: ${verdict.reason}`
      case 'unknown-component':
        return `unknown component ${verdict.ids.join(', ')}`
      case 'cycle':
        return `cycle ${verdict.path.join(' -> ')}`
      case 'undrawn-edge':
        return 'not drawn in architect.md'
      case 'unknown':
        return verdict.reason ? `unknown: ${verdict.reason}` : 'unknown'
      case 'rule-violation':
        return verdict.violations
          .map(({ path, line, message }) => `${path}${line === undefined ? '' : `:${line}`} ${message}`)
          .join('; ')
    }
  })()
  return `${asked} ${said}${stale ? ' (stale contract)' : ''}`
}

export function Verdicts({ title, held }: { title: string; held: Held }) {
  if (held.all.length === 0) return null
  return (
    <>
      <p className="replay-meta">{title}</p>
      <ul className="replay-verdicts">
        {held.all.map((record) => (
          <li key={record.id} className={held.rejected.includes(record) ? 'rejected' : undefined}>
            <span className="replay-at">{when(record.at)}</span> {verdictText(record)}
          </li>
        ))}
      </ul>
    </>
  )
}

type Props = {
  step: Step
  index: number
  total: number
  held: Held
  before?: Held
  found: number
  onOpen: (file: string) => void
}

export default function Readout({ step, index, total, held, before, found, onOpen }: Props) {
  return (
    <aside className="replay-readout" aria-live="polite">
      <p className="replay-when">
        <span className={`replay-kind ${step.kind}`}>{stepText(step)}</span>
        <span className="replay-index">
          Step {index + 1} of {total}
        </span>
      </p>
      {step.title && <p className="replay-title">{step.title}</p>}
      {step.kind === 'code' && <p className="replay-meta">{step.session ? `Session ${step.session}` : 'No session reported'}</p>}
      {step.contract.length > 0 && <p className="replay-meta">Changed in architect.md: {step.contract.join(', ')}</p>}
      {step.files.length > 0 && (
        <>
          <p className="replay-meta">
            {plural(step.files.length, 'file')} changed, {found} on the map now
          </p>
          <ul className="replay-files">
            {step.files.map((file) => (
              <li key={file}>
                <button onClick={() => onOpen(file)}>{file}</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {before && <Verdicts title="check_change verdicts before this step" held={before} />}
      <Verdicts title="check_change verdicts until the next step" held={held} />
    </aside>
  )
}
