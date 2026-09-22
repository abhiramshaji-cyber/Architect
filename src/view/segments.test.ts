import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerSegment, segmentList, subscribeSegments, truncate } from './segments'

beforeEach(() => {
  for (const segment of segmentList()) registerSegment(segment)()
})

describe('registerSegment', () => {
  it('adds a segment that appears in order', () => {
    registerSegment({ id: 'b', order: 10, text: 'B' })
    registerSegment({ id: 'a', order: 0, text: 'A' })
    expect(segmentList().map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('overwrites an existing id rather than duplicating', () => {
    registerSegment({ id: 'x', order: 0, text: 'first' })
    registerSegment({ id: 'x', order: 0, text: 'second' })
    expect(segmentList()).toHaveLength(1)
    expect(segmentList().at(0)?.text).toBe('second')
  })

  it('removes the segment when the returned cleanup runs', () => {
    const unregister = registerSegment({ id: 'y', order: 0, text: 'Y' })
    expect(segmentList().map((s) => s.id)).toContain('y')
    unregister()
    expect(segmentList().map((s) => s.id)).not.toContain('y')
  })

  it('allows an empty content segment without throwing', () => {
    registerSegment({ id: 'empty', order: 0, text: '' })
    expect(segmentList().find((s) => s.id === 'empty')?.text).toBe('')
  })

  it('handles many segments at once', () => {
    for (let i = 0; i < 50; i++) registerSegment({ id: `seg-${i}`, order: i, text: `s${i}` })
    expect(segmentList()).toHaveLength(50)
    expect(segmentList().at(0)?.id).toBe('seg-0')
    expect(segmentList().at(49)?.id).toBe('seg-49')
  })

  it('notifies subscribers on register and unregister', () => {
    const listen = vi.fn()
    const unsubscribe = subscribeSegments(listen)
    const unregister = registerSegment({ id: 'z', order: 0, text: 'Z' })
    expect(listen).toHaveBeenCalledTimes(1)
    unregister()
    expect(listen).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('does not notify when unregistering an id that is not present', () => {
    const listen = vi.fn()
    const unsubscribe = subscribeSegments(listen)
    const unregister = registerSegment({ id: 'w', order: 0, text: 'W' })
    unregister()
    unregister()
    expect(listen).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})

describe('truncate', () => {
  it('leaves short text untouched', () => {
    expect(truncate('hello', 10)).toBe('hello')
  })

  it('truncates long text with an ellipsis, respecting the max length', () => {
    const result = truncate('a'.repeat(200), 10)
    expect(result).toHaveLength(10)
    expect(result.endsWith('…')).toBe(true)
  })

  it('truncates a very long project path', () => {
    const path = '/Users/abhiramshaji/Documents/GitHub/' + 'nested-folder/'.repeat(30) + 'Architect'
    const result = truncate(path)
    expect(result.length).toBeLessThanOrEqual(80)
  })

  it('keeps text at exactly the max length as is', () => {
    expect(truncate('1234567890', 10)).toBe('1234567890')
  })

  it('does not blow up on a max length of zero', () => {
    expect(truncate('anything', 0)).toBe('')
  })

  it('applies truncation automatically when a segment is registered', () => {
    registerSegment({ id: 'long', order: 0, text: 'x'.repeat(500) })
    const text = segmentList().find((s) => s.id === 'long')?.text ?? ''
    expect(text.length).toBeLessThanOrEqual(80)
  })
})
