import { formatKey } from './chords'
import type { ChordStep } from './chords'

export default function KeyHintOverlay({ steps }: { steps: ChordStep[] }) {
  if (steps.length === 0) return null

  return (
    <div className="key-hint-overlay" role="status">
      {steps.map((step) => (
        <div key={step.key} className="key-hint-row">
          <kbd>{formatKey(step.key)}</kbd>
          <span>{step.label}</span>
        </div>
      ))}
    </div>
  )
}
