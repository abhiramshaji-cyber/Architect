import type { FunctionImpact } from '../../../shared/types'
import Mark, { plural } from '../functions/Mark'

function callers(fn: FunctionImpact): string {
  return fn.fanIn === null ? `line ${fn.line}` : `called by ${plural(fn.fanIn, 'function')} · line ${fn.line}`
}

export default function Impact({ functions }: { functions: FunctionImpact[] }) {
  if (functions.length === 0) return <p className="review-note">No functions added, removed or changed.</p>

  return (
    <ul className="review-functions">
      {functions.map((fn) => (
        <li key={`${fn.change}:${fn.name}:${fn.line}`} className={`review-fn mark-${fn.change}`}>
          <span className="review-chip">{fn.change}</span>
          <span className="fn-name">{fn.name}</span>
          {fn.importance !== null && <Mark importance={fn.importance} />}
          <span className="review-calls">{callers(fn)}</span>
        </li>
      ))}
    </ul>
  )
}
