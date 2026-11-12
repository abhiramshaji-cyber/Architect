import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Coupling, CouplingPair } from '../../../shared/types'
import Pair from './Pair'

const pair: CouplingPair = {
  files: ['src/a.ts', 'lib/a.ts'],
  commits: { shared: ['abc123456', 'def987654'], changes: [4, 2], confidence: 1 },
  sessions: { shared: [], changes: [0, 3], confidence: 0 },
}

const coupling: Coupling = {
  ask: { days: 90, minShared: 2, minConfidence: 0.5, maxFiles: 30 },
  skipped: 0,
  historyFrom: null,
  commits: { abc123456: { short: 'abc1234', at: Date.UTC(2026, 10, 2), subject: 'move the reader' } },
  sessions: {},
  pairs: [pair],
}

describe('Pair', () => {
  const html = renderToStaticMarkup(<Pair pair={pair} coupling={coupling} onOpen={() => {}} />)

  it('shows the shared counts, the confidence and each file’s own ratio, without a ratio for no changes', () => {
    expect(html).toContain('2 shared commits, confidence 100%')
    expect(html).toContain('0 shared sessions, confidence 0%')
    expect(html).toContain('2 of its 4 commits (50%)')
    expect(html).toContain('2 of its 2 commits (100%)')
    expect(html).toContain('0 of its 0 sessions')
    expect(html).toContain('0 of its 3 sessions (0%)')
  })

  it('lists each commit as evidence, falling back to the sha when its details are missing', () => {
    expect(html).toContain('<code>abc1234</code> 2026-11-02 move the reader')
    expect(html).toContain('<code>def9876</code>')
  })
})
