import { STEPS } from '../../model/recency'

export default function Legend({ className = '' }: { className?: string }) {
  return (
    <span className={`age-legend ${className}`} title="Colour shows how recently the code changed">
      newest
      {Array.from({ length: STEPS }, (_, step) => (
        <i key={step} className={`age-swatch age-${step}`} aria-hidden="true" />
      ))}
      oldest
    </span>
  )
}
