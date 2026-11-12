export type Axis = { at: (value: number) => number; ticks: number[] }

export function axis(max: number): Axis {
  const limit = Number.isFinite(max) && max > 0 ? max : 0
  const top = Math.log10(1 + limit)
  const ticks = [0]
  for (let step = 1; step <= limit; step *= 10) ticks.push(step)
  return { at: (value) => (top > 0 ? Math.min(1, Math.log10(1 + Math.max(0, value)) / top) : 0), ticks }
}
