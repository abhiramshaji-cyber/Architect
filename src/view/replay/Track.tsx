import type { KeyboardEvent, PointerEvent } from 'react'
import type { VerdictRecord } from '../../../shared/types'
import type { Step } from './timeline/steps'
import type { Held } from './timeline/verdicts'

type Props = {
  steps: Step[]
  at: number
  held: Held[]
  onAt: (at: number) => void
  describe: (step: Step) => string
  verdictText: (record: VerdictRecord) => string
}

export default function Track({ steps, at, held, onAt, describe, verdictText }: Props) {
  const last = steps.length - 1
  const place = (index: number) => (last <= 0 ? 50 : (index / last) * 100)
  const clamp = (index: number) => Math.min(last, Math.max(0, index))

  const seek = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width > 0) onAt(clamp(Math.round(((event.clientX - rect.left) / rect.width) * last)))
  }

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: at - 1,
      ArrowRight: at + 1,
      Home: 0,
      End: last,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    onAt(clamp(next))
  }

  const step = steps[at]
  return (
    <div className="replay-track-box">
      <div className="replay-marks" aria-label="Rejected check_change verdicts">
        {held.map(({ rejected }, index) => {
          if (rejected.length === 0) return null
          return (
            <button
              key={index}
              className={index === at ? 'replay-mark on' : 'replay-mark'}
              style={{ left: `${place(index)}%` }}
              title={rejected.map(verdictText).join('\n')}
              aria-label={`${rejected.length} rejected at step ${index + 1}`}
              onClick={() => onAt(index)}
            >
              {rejected.length > 1 ? rejected.length : ''}
            </button>
          )
        })}
      </div>
      <div
        className="replay-track"
        role="slider"
        tabIndex={0}
        aria-label="Timeline"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={at + 1}
        aria-valuetext={step ? describe(step) : ''}
        onKeyDown={key}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          seek(event)
        }}
        onPointerMove={(event) => event.buttons === 1 && seek(event)}
      >
        <svg className="replay-ticks" preserveAspectRatio="none" viewBox="0 0 100 10">
          {steps.map((item, index) => (
            <line key={item.key} className={`replay-tick ${item.kind}`} x1={place(index)} x2={place(index)} y1={2} y2={8} />
          ))}
        </svg>
        <div className="replay-fill" style={{ width: `${place(at)}%` }} />
        <div className="replay-head" style={{ left: `${place(at)}%` }} />
      </div>
    </div>
  )
}
