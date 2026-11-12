import { HISTORY_LIMIT } from '../../../../shared/types'

export type Recorded = { at: number; by: 'history' | 'verdicts' }

export function recordedFrom(history: { at: number }[], verdicts: { at: number }[]): Recorded | null {
  let found: Recorded | null = null
  for (const [list, by] of [
    [history, 'history'],
    [verdicts, 'verdicts'],
  ] as const) {
    if (list.length < HISTORY_LIMIT) continue
    const oldest = list.reduce((low, item) => Math.min(low, item.at), Infinity)
    if (!found || oldest > found.at) found = { at: oldest, by }
  }
  return found
}
