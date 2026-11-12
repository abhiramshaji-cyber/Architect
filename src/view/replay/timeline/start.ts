import { HISTORY_LIMIT } from '../../../../shared/types'

export type Start = { at: number; by: 'window' | 'commits' | 'history' | 'verdicts' }

export function startOf(since: number, capped: boolean, history: { at: number }[], verdicts: { at: number }[]): Start {
  let start: Start = { at: since, by: capped ? 'commits' : 'window' }
  for (const [list, by] of [
    [history, 'history'],
    [verdicts, 'verdicts'],
  ] as const) {
    if (list.length < HISTORY_LIMIT) continue
    const oldest = list.reduce((low, item) => Math.min(low, item.at), Infinity)
    if (oldest > start.at) start = { at: oldest, by }
  }
  return start
}
