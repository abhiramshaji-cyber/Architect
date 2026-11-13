import { describe, expect, it } from 'vitest'
import type { FunctionRow } from '../../../shared/types'
import { refound, startOf } from './Picker'

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

describe('picking a starting point again after an edit', () => {
  it('follows the same function when lines are added above it', () => {
    const before = [row('go', 10), row('other', 20)]
    const held = startOf(before, before[0]!)
    expect(refound([row('go', 14), row('other', 24)], held)?.line).toBe(14)
  })

  it('keeps the second of two namesakes the second, however far both moved', () => {
    const before = [row('run', 10), row('run', 50)]
    const held = startOf(before, before[1]!)
    expect(refound([row('run', 75), row('run', 35)], held)?.line).toBe(75)
  })

  it('lets go of one that is gone or no longer a starting point', () => {
    const held = startOf([row('go', 10)], row('go', 10))
    expect(refound([row('other', 10)], { ...held })).toBeNull()
    expect(refound([row('go', 10, false)], held)).toBeNull()
  })
})
