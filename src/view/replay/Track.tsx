import type { KeyboardEvent, PointerEvent } from 'react'
import { stepText, verdictText } from './Readout'
import type { Step } from './timeline/steps'
import type { Filed, Held } from './timeline/verdicts'

type Props = {
  steps: Step[]
  at: number
  filed: Filed
  onAt: (at: number) => void
}

export default function Track({ steps, at, filed, onAt }: Props) {
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

  const marks = [
    { ...filed.before, index: 0, where: 'before' },
    ...filed.steps.map((held: Held, index) => ({ ...held, index, where: `${index}` })),
  ].filter(({ rejected }) => rejected.length > 0)

  const step = steps[at]
  return (
    <div className="replay-track-box">
      <div className="replay-marks" aria-label="Rejected check_change verdicts">
        {marks.map(({ index, rejected, where }) => (
          <button
            key={where}
            className={index === at && where !== 'before' ? 'replay-mark on' : 'replay-mark'}
            style={{ left: `${where === 'before' ? 0 : place(index)}%` }}
            title={rejected.map(verdictText).join('\n')}
            aria-label={`${rejected.length} rejected ${where === 'before' ? 'before step 1' : `at step ${index + 1}`}`}
            onClick={() => onAt(index)}
          >
            {rejected.length > 1 ? rejected.length : ''}
          </button>
        ))}
      </div>
      <div
        className="replay-track"
        role="slider"
        tabIndex={0}
        aria-label="Timeline"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={at + 1}
        aria-valuetext={step ? stepText(step) : ''}
        onKeyDown={key}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          seek(event)
        }}
        onPointerMove={(event) => event.buttons === 1 && seek(event)}
      >
        <div className="replay-fill" style={{ width: `${place(at)}%` }} />
        <svg className="replay-ticks" preserveAspectRatio="none" viewBox="0 0 100 10">
          {steps.map((item, index) => (
            <line key={item.key} className={`replay-tick ${item.kind}`} x1={place(index)} x2={place(index)} y1={2} y2={8} />
          ))}
        </svg>
        <div className="replay-head" style={{ left: `${place(at)}%` }} />
      </div>
    </div>
  )
}
