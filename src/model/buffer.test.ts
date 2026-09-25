import { describe, expect, it } from 'vitest'
import type { SourceError, WriteError } from '../../shared/types'
import { isDirty, refusalOf } from './buffer'

const buffer = (disk: string, draft: string, error: SourceError | null = null) => ({
  path: 'a.ts',
  disk,
  hash: 'h',
  draft,
  error,
})

describe('refusalOf', () => {
  it('has a sentence for every read and write refusal', () => {
    const errors: (SourceError | WriteError)[] = [
      'closed',
      'range',
      'outside',
      'unreadable',
      'binary',
      'large',
      'stale',
      'denied',
    ]

    for (const error of errors) expect(refusalOf(error)).toMatch(/\S/)
    expect(new Set(errors.map(refusalOf)).size).toBe(errors.length)
  })
})

describe('isDirty', () => {
  it('is true only when a readable buffer differs from disk', () => {
    expect(isDirty(null)).toBe(false)
    expect(isDirty(buffer('one\n', 'one\n'))).toBe(false)
    expect(isDirty(buffer('one\n', 'two\n'))).toBe(true)
    expect(isDirty(buffer('', '', 'binary'))).toBe(false)
  })
})
