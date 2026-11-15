import { describe, expect, it } from 'vitest'
import type { FunctionRow } from '../../../shared/types'
import { refound } from '../flow/Picker'
import { startFrom } from './start'

const row = (name: string, line: number, entry = true): FunctionRow => ({
  file: 'a.ts',
  name,
  line,
  lines: 1,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: entry ? { reason: 'mcpTool', file: 'a.ts' } : null,
  untraced: null,
  importance: 1,
})

describe('a remembered flow starting point', () => {
  it('lands on the exact function, even among namesakes', () => {
    const rows = [row('run', 10), row('run', 50)]
    const start = startFrom(rows, 'a.ts\u000050\u0000run')
    expect(start && refound(rows, start)?.line).toBe(50)
  })

  it('follows a lone namesake that moved', () => {
    const rows = [row('go', 14)]
    const start = startFrom(rows, 'a.ts\u000010\u0000go')
    expect(start && refound(rows, start)?.line).toBe(14)
  })

  it('lets go of nothing stored, a moved namesake of two, a gone function or one that is no starting point', () => {
    expect(startFrom([row('go', 10)], null)).toBeNull()
    expect(startFrom([row('run', 11), row('run', 51)], 'a.ts\u000010\u0000run')).toBeNull()
    expect(startFrom([row('other', 10)], 'a.ts\u000010\u0000go')).toBeNull()
    expect(startFrom([row('go', 10, false)], 'a.ts\u000010\u0000go')).toBeNull()
  })
})
