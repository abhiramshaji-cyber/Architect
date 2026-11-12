import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT } from '../../../../shared/types'
import { startOf } from './start'

const times = (count: number, from: number) => Array.from({ length: count }, (_, at) => ({ at: from + at }))

describe('replay start', () => {
  it('starts at the window when no list is full', () => {
    expect(startOf(100, false, times(HISTORY_LIMIT - 1, 500), times(3, 900))).toEqual({ at: 100, by: 'window' })
  })

  it('says the commit cap set the start', () => {
    expect(startOf(100, true, [], [])).toEqual({ at: 100, by: 'commits' })
  })

  it('starts at the oldest kept entry of a full history or verdict list, the later of the two', () => {
    expect(startOf(100, false, times(HISTORY_LIMIT, 500), [])).toEqual({ at: 500, by: 'history' })
    expect(startOf(100, false, times(HISTORY_LIMIT, 500), times(HISTORY_LIMIT, 700))).toEqual({ at: 700, by: 'verdicts' })
  })

  it('keeps the window when a full list reaches further back', () => {
    expect(startOf(1000, false, times(HISTORY_LIMIT, 500), [])).toEqual({ at: 1000, by: 'window' })
  })
})
