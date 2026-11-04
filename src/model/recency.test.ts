import { describe, expect, it } from 'vitest'
import type { Change } from '../../shared/types'
import { agoOf, describeChange, ranker } from './recency'

const at = (time: number): Change => ({ at: time, sha: String(time), subject: `s${time}` })
const DAY = 86_400_000

describe('ranker', () => {
  it('spreads distinct dates from newest to oldest', () => {
    const changes = [1, 2, 3, 4, 5].map((n) => at(n * DAY))
    const step = ranker(changes)
    expect(changes.map(step)).toEqual([4, 3, 2, 1, 0])
  })

  it('ranks by order so one outlier does not flatten the rest', () => {
    const changes = [at(1), at(2), at(3), at(100 * 365 * DAY)]
    const step = ranker(changes)
    expect(changes.map(step)).toEqual([4, 3, 1, 0])
  })

  it('gives equal dates the same step and counts uncommitted as newest', () => {
    const changes: Change[] = [at(5), at(5), 'uncommitted', at(1)]
    const step = ranker(changes)
    expect(changes.map(step)).toEqual([2, 2, 0, 4])
  })

  it('still spreads a repo touched only long ago', () => {
    const year = 365 * DAY
    const step = ranker([at(year), at(year + DAY)])
    expect([step(at(year + DAY)), step(at(year))]).toEqual([0, 4])
  })

  it('handles one date, no dates and unknown changes', () => {
    expect(ranker([at(7)])(at(7))).toBe(0)
    expect(ranker([])(at(7))).toBeUndefined()
    expect(ranker([at(7)])(undefined)).toBeUndefined()
  })
})

describe('agoOf', () => {
  it('names the largest whole unit', () => {
    const now = 1000 * DAY
    expect(agoOf(now - 2 * DAY, now)).toBe('2 days ago')
    expect(agoOf(now - DAY, now)).toBe('yesterday')
    expect(agoOf(now - 3 * 3_600_000, now)).toBe('3 hours ago')
    expect(agoOf(now - 400 * DAY, now)).toBe('last year')
    expect(agoOf(now - 5000, now)).toBe('just now')
    expect(agoOf(now + 2 * DAY, now)).toBe('in 2 days')
  })
})

describe('describeChange', () => {
  it('reads the date and subject, or uncommitted', () => {
    const now = 10 * DAY
    expect(describeChange({ at: 8 * DAY, sha: 'a', subject: 'fix it' }, now)).toBe('Changed 2 days ago: fix it')
    expect(describeChange({ at: 8 * DAY, sha: 'a', subject: '' }, now)).toBe('Changed 2 days ago')
    expect(describeChange('uncommitted', now)).toBe('Uncommitted changes')
    expect(describeChange(undefined, now)).toBeUndefined()
  })
})
