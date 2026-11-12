import type { VerdictRecord } from '../../../../shared/types'
import type { Step } from './steps'

export type Held = { all: VerdictRecord[]; rejected: VerdictRecord[] }

export type Filed = { before: Held; steps: Held[] }

export function stepAt(steps: Step[], at: number): number {
  let low = 0
  let high = steps.length
  while (low < high) {
    const mid = (low + high) >> 1
    if ((steps[mid]?.at ?? 0) <= at) low = mid + 1
    else high = mid
  }
  return Math.max(0, low - 1)
}

export function verdictsAt(steps: Step[], records: VerdictRecord[], since: number): Filed {
  const filed: Filed = { before: { all: [], rejected: [] }, steps: steps.map(() => ({ all: [], rejected: [] })) }
  const first = steps[0]?.at ?? Infinity

  for (const record of [...records].sort((a, b) => a.at - b.at)) {
    if (record.at < since) continue
    const slot = record.at < first ? filed.before : filed.steps[stepAt(steps, record.at)]
    if (!slot) continue
    slot.all.push(record)
    if (record.verdict.status !== 'allowed' && record.verdict.status !== 'unknown') slot.rejected.push(record)
  }
  return filed
}
