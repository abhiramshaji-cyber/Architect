import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT } from '../../../../shared/types'
import { recordedFrom } from './recorded'

const times = (count: number, from: number) => Array.from({ length: count }, (_, at) => ({ at: from + at }))

describe('replay recorded', () => {
  it('reports nothing while neither list is at its limit', () => {
    expect(recordedFrom(times(HISTORY_LIMIT - 1, 500), times(3, 900))).toBeNull()
  })

  it('reports the oldest kept entry of a full list, the later of the two', () => {
    expect(recordedFrom(times(HISTORY_LIMIT, 500), [])).toEqual({ at: 500, by: 'history' })
    expect(recordedFrom(times(HISTORY_LIMIT, 500), times(HISTORY_LIMIT, 700))).toEqual({ at: 700, by: 'verdicts' })
    expect(recordedFrom(times(HISTORY_LIMIT, 900), times(HISTORY_LIMIT, 700))).toEqual({ at: 900, by: 'history' })
  })
})
