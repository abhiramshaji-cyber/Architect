import { describe, expect, it } from 'vitest'
import type { VerdictRecord } from '../../../../shared/types'
import type { Step } from './steps'
import { stepAt, verdictsAt } from './verdicts'

const step = (at: number): Step => ({ key: `s${at}`, at, kind: 'commit', files: ['a.ts'], components: [], title: '' })

const verdict = (id: string, at: number, status: 'allowed' | 'forbidden' | 'unknown' | 'undrawn-edge'): VerdictRecord => ({
  id,
  root: '/r',
  at,
  from: 'a',
  to: 'b',
  verdict: status === 'forbidden' ? { status, reason: 'no' } : { status },
})

const ids = (list: VerdictRecord[]) => list.map((record) => record.id)

describe('replay verdicts', () => {
  const steps = [step(100), step(200), step(300)]

  it('finds the last step at or before a moment', () => {
    expect([stepAt(steps, 50), stepAt(steps, 100), stepAt(steps, 250), stepAt(steps, 900)]).toEqual([0, 0, 1, 2])
  })

  it('files each verdict under the last step at or before it, oldest first', () => {
    const held = verdictsAt(
      steps,
      [
        verdict('late', 900, 'forbidden'),
        verdict('early', 10, 'allowed'),
        verdict('first', 5, 'allowed'),
        verdict('gone', -5, 'forbidden'),
      ],
      0,
    )
    expect(held.map(({ all }) => ids(all))).toEqual([['first', 'early'], [], ['late']])
  })

  it('marks every verdict but allowed and unknown as rejected', () => {
    const held = verdictsAt(
      steps,
      [
        verdict('a', 100, 'allowed'),
        verdict('u', 100, 'unknown'),
        verdict('f', 100, 'forbidden'),
        verdict('d', 100, 'undrawn-edge'),
      ],
      0,
    )
    expect(ids(held[0]?.rejected ?? [])).toEqual(['f', 'd'])
  })

  it('holds no verdicts when there are no steps', () => {
    expect(verdictsAt([], [verdict('v', 1, 'forbidden')], 0)).toEqual([])
  })
})
