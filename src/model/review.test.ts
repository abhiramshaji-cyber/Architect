import { describe, expect, it } from 'vitest'
import type { Architecture, ReviewItem } from '../../shared/types'
import { describeItem, overlay, reviewText } from './review'

const base: Architecture = {
  title: 'T',
  summary: 'S',
  components: [
    { id: 'api', purpose: 'p', owns: ['api/**'] },
    { id: 'db', purpose: 'p', owns: ['db/**'] },
    { id: 'old', purpose: 'p', owns: ['old/**'] },
  ],
  edges: [
    { from: 'api', to: 'db' },
    { from: 'api', to: 'old' },
  ],
  forbidden: [],
  packages: [],
}

const code: ReviewItem = { kind: 'code', id: '1', root: '/p', at: 0, file: 'api/a.ts', tool: 'MultiEdit' }

describe('overlay', () => {
  it('keeps removed parts on the canvas and marks every difference', () => {
    const after: Architecture = {
      ...base,
      components: [
        { id: 'api', purpose: 'p', owns: ['api/**', 'web/**'] },
        { id: 'db', purpose: 'p', owns: ['db/**'] },
        { id: 'queue', purpose: 'p', owns: [] },
      ],
      edges: [
        { from: 'api', to: 'db' },
        { from: 'api', to: 'queue' },
      ],
    }

    const shown = overlay(base, after, ['db'])
    expect(shown?.architecture.components.map((c) => c.id)).toEqual(['api', 'db', 'queue', 'old'])
    expect(shown?.architecture.edges).toHaveLength(3)
    expect(shown?.marks).toEqual({
      api: 'changed',
      db: 'touched',
      queue: 'added',
      old: 'removed',
      'api->queue': 'added',
      'api->old': 'removed',
    })
  })

  it('marks only the owners when nothing in the contract changes', () => {
    expect(overlay(base, base, ['api', 'ghost'])?.marks).toEqual({ api: 'touched' })
  })

  it('shows the current contract unmarked when the proposal no longer applies', () => {
    expect(overlay(base, null, [])).toEqual({ architecture: base, marks: {} })
  })

  it('marks a whole first contract as added and has nothing to show without one', () => {
    expect(Object.values(overlay(null, base, [])?.marks ?? {}).every((mark) => mark === 'added')).toBe(true)
    expect(overlay(null, null, [])).toBeNull()
  })
})

describe('reviewText', () => {
  it('is silent while off with nothing waiting', () => {
    expect(reviewText({ enabled: false, items: [] })).toBe('')
  })

  it('counts what is waiting', () => {
    expect(reviewText({ enabled: true, items: [] })).toBe('Review on')
    expect(reviewText({ enabled: true, items: [code, code] })).toBe('Review on · 2 pending')
    expect(reviewText({ enabled: false, items: [code] })).toBe('Review off · 1 pending')
  })
})

describe('describeItem', () => {
  const proposal = (value: Extract<ReviewItem, { kind: 'proposal' }>['proposal']): ReviewItem => ({
    kind: 'proposal',
    id: '1',
    root: '/p',
    at: 0,
    proposal: value,
    rationale: '',
  })

  it('names each kind of change', () => {
    expect(describeItem(code)).toBe('Edit api/a.ts')
    expect(describeItem({ ...code, tool: 'Write' })).toBe('Write api/a.ts')
    expect(describeItem(proposal({ kind: 'edge', from: 'a', to: 'b' }))).toBe('Add dependency a -> b')
    expect(describeItem(proposal({ kind: 'component', id: 'a', purpose: '', owns: [] }))).toBe('Add component a')
    expect(describeItem(proposal({ kind: 'remove_component', id: 'a' }))).toBe('Remove component a')
    expect(describeItem(proposal({ kind: 'package', name: 'zod', component: 'a' }))).toBe('Add package zod to a')
    expect(describeItem(proposal({ kind: 'file', path: 'x.ts', component: 'a' }))).toBe('Give x.ts to a')
    expect(describeItem(proposal({ kind: 'contract', markdown: '' }))).toBe('Adopt a first architect.md')
  })
})
