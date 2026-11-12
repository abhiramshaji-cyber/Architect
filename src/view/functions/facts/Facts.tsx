import type { MouseEvent } from 'react'
import type { FunctionRow } from '../../../../shared/types'
import { plural } from '../Mark'
import type { Way } from './calls'

type FactsProps = {
  row: FunctionRow
  at: number
  onRelated: (at: number, way: Way) => void
}

export default function Facts({ row, at, onRelated }: FactsProps) {
  const outside = row.outside ?? 0
  const ask = (way: Way) => (event: MouseEvent) => {
    event.stopPropagation()
    onRelated(at, way)
  }
  return (
    <span className="fn-facts">
      <button className="fn-count-link" disabled={row.fanIn === 0 && outside === 0} onClick={ask('callers')}>
        {plural(row.fanIn, 'caller')}
        {outside > 0 && ` +${outside.toLocaleString()} outside`}
      </button>
      <button className="fn-count-link" disabled={row.fanOut === 0} onClick={ask('callees')}>
        {plural(row.fanOut, 'callee')}
      </button>
    </span>
  )
}
