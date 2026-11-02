const STEPS = [1, 2, 3, 4, 5]

export function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`
}

export default function Mark({ importance }: { importance: number }) {
  return (
    <span
      className="fn-mark"
      role="img"
      aria-label={`importance ${importance} of 5`}
      title={`Importance ${importance} of 5`}
    >
      {STEPS.map((step) => (
        <span key={step} className={step <= importance ? 'fn-step on' : 'fn-step'} />
      ))}
    </span>
  )
}
