import type { MouseEvent } from 'react'
import type { FunctionRow } from '../../../../shared/types'
import { plural } from '../Mark'
import { outsideOf, type Way } from './calls'

type FactsProps = {
  row: FunctionRow
  at: number
  onRelated: (at: number, way: Way) => void
  onFocus?: (at: number) => void
}

const WORD: Record<Way, string> = { callers: 'caller', callees: 'callee' }

export default function Facts({ row, at, onRelated, onFocus }: FactsProps) {
  const ask = (way: Way) => (event: MouseEvent) => {
    event.stopPropagation()
    onRelated(at, way)
  }
  return (
    <span className="fn-facts">
      {(['callers', 'callees'] as const).map((way) => {
        const inside = way === 'callers' ? row.fanIn : row.fanOut
        const outside = outsideOf(row, way)
        return (
          <button key={way} className="fn-count-link" disabled={inside + outside === 0} onClick={ask(way)}>
            {plural(inside, WORD[way])}
            {outside > 0 && ` +${outside.toLocaleString()} outside`}
          </button>
        )
      })}
      {onFocus && (
        <button
          className="fn-count-link"
          title={`Show what calls ${row.name} and what it calls`}
          onClick={(event) => {
            event.stopPropagation()
            onFocus(at)
          }}
        >
          Focus
        </button>
      )}
    </span>
  )
}
