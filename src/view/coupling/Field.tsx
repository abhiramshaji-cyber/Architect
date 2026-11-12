type FieldProps = { label: string; value: number; min: number; max: number; onValue: (value: number) => void }

export function wholeIn(text: string, min: number, max: number): number | null {
  const value = text.trim() === '' ? Number.NaN : Number(text)
  return Number.isInteger(value) && value >= min && value <= max ? value : null
}

export default function Field({ label, value, min, max, onValue }: FieldProps) {
  const settle = (input: HTMLInputElement) => {
    const next = wholeIn(input.value, min, max)
    if (next === null) input.value = String(value)
    else if (next !== value) onValue(next)
  }
  return (
    <label className="cp-field">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        defaultValue={value}
        onBlur={(e) => settle(e.currentTarget)}
        onKeyDown={(e) => e.key === 'Enter' && settle(e.currentTarget)}
      />
    </label>
  )
}
