import { describe, expect, it } from 'vitest'
import type { VerdictRecord } from '../../../shared/types'
import { verdictText } from './Readout'

const base = { id: 'v', root: '/r', at: 1 }

const violation = {
  rule: 'lines',
  path: 'src/a.ts',
  line: 3,
  key: 'k',
  amount: 201,
  message: '201 lines, the limit is 200',
} as const

describe('verdict text', () => {
  it('names the edge for an edge verdict', () => {
    const record: VerdictRecord = {
      ...base,
      from: 'a',
      to: 'b',
      file: 'src/a.ts',
      verdict: { status: 'forbidden', reason: 'no' },
    }
    expect(verdictText(record)).toBe('a -> b forbidden: no')
  })

  it('names the file and each violation path for a rule violation, never the allowed edge', () => {
    const record = {
      ...base,
      from: 'a',
      to: 'b',
      file: 'src/a.ts',
      verdict: { status: 'rule-violation', violations: [violation] },
    }
    expect(verdictText(record as VerdictRecord)).toBe('src/a.ts src/a.ts:3 201 lines, the limit is 200')
  })

  it('marks a verdict from a stale contract', () => {
    expect(verdictText({ ...base, file: 'x.ts', verdict: { status: 'allowed' }, stale: true })).toBe(
      'x.ts allowed (stale contract)',
    )
  })
})
