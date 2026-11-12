import { FLOOR, MODES, SPAN, type Mode } from './palette'
import type { ModeId } from './shade'

type Props = { mode: Mode; high?: string; onMode: (mode: ModeId) => void }

export default function Legend({ mode, high, onMode }: Props) {
  const ramp = `linear-gradient(to right, color-mix(in srgb, var(${mode.token}) ${FLOOR * 100}%, var(--raise)), color-mix(in srgb, var(${mode.token}) ${(FLOOR + SPAN) * 100}%, var(--raise)))`
  return (
    <div className="map-legend">
      <div className="fn-sort" role="group" aria-label="Colour by">
        {MODES.map(({ id, label, title }) => (
          <button
            key={id}
            className={id === mode.id ? 'mode active' : 'mode'}
            aria-pressed={id === mode.id}
            title={title}
            onClick={() => onMode(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="map-scale" title={mode.title}>
        {mode.low}
        <i className="map-ramp" style={{ background: ramp }} aria-hidden="true" />
        {high ?? mode.high}
      </span>
      <span className="map-key">{mode.title}. Area is lines of code.</span>
    </div>
  )
}
