import type { CouplingAsk } from '../../shared/types'

export const DEFAULT_ASK: CouplingAsk = { days: 90, minShared: 3, minConfidence: 0.5, maxFiles: 30 }

export const LIMITS: Record<keyof CouplingAsk, [number, number]> = { days: [1, 36_500], minShared: [1, 100_000], minConfidence: [0, 1], maxFiles: [2, 1000] }

export function askOf(raw: unknown): CouplingAsk {
  const given = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof CouplingAsk, unknown>>
  const pick = (key: keyof CouplingAsk, whole: boolean): number => {
    const value = given[key]
    const [min, max] = LIMITS[key]
    const fits = typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!whole || Number.isInteger(value))
    return fits ? value : DEFAULT_ASK[key]
  }
  return { days: pick('days', true), minShared: pick('minShared', true), minConfidence: pick('minConfidence', false), maxFiles: pick('maxFiles', true) }
}
