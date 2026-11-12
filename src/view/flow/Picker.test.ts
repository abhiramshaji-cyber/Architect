import { describe, expect, it } from 'vitest'
import type { FunctionRow } from '../../../shared/types'
import { refound } from './Picker'

const row = (name: string, line: number, entry = true): FunctionRow => ({
  file: 'a.ts',
  name,
  line,
  lines: 1,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: entry ? { reason: 'mcpTool', file: 'a.ts' } : null,
  importance: 1,
})

describe('refound', () => {
  it('follows a starting point that moved after an edit', () => {
    expect(refound([row('go', 14)], { file: 'a.ts', name: 'go', line: 10 })).toEqual({ file: 'a.ts', name: 'go', line: 14 })
  })

  it('picks the nearest of several with the same name', () => {
    expect(refound([row('go', 2), row('go', 30), row('go', 12)], { file: 'a.ts', name: 'go', line: 10 })?.line).toBe(12)
  })

  it('lets go of one that is gone or no longer a starting point', () => {
    expect(refound([row('other', 10)], { file: 'a.ts', name: 'go', line: 10 })).toBeNull()
    expect(refound([row('go', 10, false)], { file: 'a.ts', name: 'go', line: 10 })).toBeNull()
  })
})
