import { describe, expect, it } from 'vitest'
import type { Architecture } from '../../../shared/types'
import { applyAction, DEFAULT_VIEW } from './action'

const architecture: Architecture = {
  title: 'Bot',
  summary: '',
  components: [
    { id: 'chat', purpose: '', owns: ['src/chat/**'] },
    { id: 'kb', purpose: '', owns: ['src/kb/**'] },
    { id: 'llm', purpose: '', owns: [] }
  ],
  edges: [
    { from: 'chat', to: 'kb', label: 'search' },
    { from: 'kb', to: 'llm' }
  ],
  forbidden: [],
  packages: []
}

describe('applyAction', () => {
  it('leaves the view alone for a null action', () => {
    expect(applyAction(DEFAULT_VIEW, null, architecture)).toEqual({ view: DEFAULT_VIEW, notes: [] })
  })

  it('merges valid settings into the current view', () => {
    const start = { ...DEFAULT_VIEW, labels: false }
    const { view, notes } = applyAction(start, { layout: 'left-right', spacing: 'roomy', group: true, externals: false }, architecture)
    expect(view).toEqual({ ...start, layout: 'left-right', spacing: 'roomy', group: true, externals: false })
    expect(notes).toEqual([])
  })

  it('resets before applying the rest', () => {
    const start = { ...DEFAULT_VIEW, labels: false, hide: ['kb'] }
    expect(applyAction(start, { reset: true, layout: 'left-right' }, architecture).view).toEqual({ ...DEFAULT_VIEW, layout: 'left-right' })
  })

  it('drops unknown component names and says so', () => {
    const { view, notes } = applyAction(DEFAULT_VIEW, { hide: ['llm', 'database', 'LLM'] }, architecture)
    expect(view.hide).toEqual(['llm'])
    expect(notes).toEqual(['The diagram has no component named "database"'])
  })

  it('matches a name that differs only in case when exactly one component fits', () => {
    expect(applyAction(DEFAULT_VIEW, { focus: { components: ['KB'] } }, architecture).view.focus).toEqual({ components: ['kb'] })
  })

  it('keeps the old focus when none of its components exist', () => {
    const start = { ...DEFAULT_VIEW, focus: { components: ['chat'] } }
    const { view, notes } = applyAction(start, { focus: { components: ['nope'], depth: 2 } }, architecture)
    expect(view.focus).toEqual({ components: ['chat'] })
    expect(notes).toContain('Kept the focus as it was: none of its components are in the diagram')
  })

  it('clears focus and path on null', () => {
    const start = { ...DEFAULT_VIEW, focus: { components: ['chat'] }, path: { from: 'chat', to: 'kb' } }
    const { view } = applyAction(start, { focus: null, path: null }, architecture)
    expect(view.focus).toBeNull()
    expect(view.path).toBeNull()
  })

  it('sets a path only when the edges connect the two ends', () => {
    expect(applyAction(DEFAULT_VIEW, { path: { from: 'chat', to: 'llm' } }, architecture).view.path).toEqual({ from: 'chat', to: 'llm' })

    const backwards = applyAction(DEFAULT_VIEW, { path: { from: 'llm', to: 'chat' } }, architecture)
    expect(backwards.view.path).toBeNull()
    expect(backwards.notes).toEqual(['The diagram has no path from llm to chat'])
  })

  it('ignores invalid values and unknown settings field by field', () => {
    const { view, notes } = applyAction(DEFAULT_VIEW, { layout: 'diagonal', labels: false, colour: 'red', focus: { components: ['kb'], depth: 9 } }, architecture)
    expect(view).toEqual({ ...DEFAULT_VIEW, labels: false })
    expect(notes).toEqual([
      'Ignored the view setting "layout": its value was not valid',
      'Ignored the unknown view setting "colour"',
      'Ignored the view setting "focus": its value was not valid'
    ])
  })

  it('refuses an action that is not an object', () => {
    expect(applyAction(DEFAULT_VIEW, ['hide'], architecture).notes).toEqual(['Ignored a view change that was not a set of settings'])
    expect(applyAction(DEFAULT_VIEW, 'left-right', architecture).view).toBe(DEFAULT_VIEW)
  })
})
