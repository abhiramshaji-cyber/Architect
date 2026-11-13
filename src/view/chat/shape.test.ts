import { describe, expect, it } from 'vitest'
import type { Architecture } from '../../../shared/types'
import { DEFAULT_VIEW } from './action'
import { route, shape } from './shape'

const architecture: Architecture = {
  title: 'Bot',
  summary: '',
  components: [
    { id: 'ui', purpose: '', owns: ['ui/**'] },
    { id: 'chat', purpose: '', owns: ['chat/**'] },
    { id: 'kb', purpose: '', owns: ['kb/**'] },
    { id: 'db', purpose: '', owns: ['db/**'] },
    { id: 'llm', purpose: '', owns: [] }
  ],
  edges: [
    { from: 'ui', to: 'chat', label: 'send' },
    { from: 'chat', to: 'kb', label: 'search' },
    { from: 'kb', to: 'db' },
    { from: 'chat', to: 'llm' }
  ],
  forbidden: [],
  packages: [],
  layout: { ui: { x: 5, y: 5 } }
}

const ids = (a: Architecture) => a.components.map((c) => c.id)

describe('route', () => {
  it('walks the edges in their direction', () => {
    expect(route(architecture, 'ui', 'db')).toEqual({ nodes: ['ui', 'chat', 'kb', 'db'], edges: ['ui->chat', 'chat->kb', 'kb->db'] })
    expect(route(architecture, 'db', 'ui')).toBeNull()
    expect(route(architecture, 'kb', 'kb')).toEqual({ nodes: ['kb'], edges: [] })
  })
})

describe('shape', () => {
  it('passes the contract through untouched by default', () => {
    const shaped = shape(architecture, DEFAULT_VIEW)
    expect(shaped.architecture).toEqual(architecture)
    expect(shaped.tone).toEqual({})
    expect(shaped.fit).toEqual([])
    expect(shaped.sideways).toBe(false)
  })

  it('hides listed components, externals and their edges', () => {
    const shaped = shape(architecture, { ...DEFAULT_VIEW, hide: ['db'], externals: false })
    expect(ids(shaped.architecture)).toEqual(['ui', 'chat', 'kb'])
    expect(shaped.architecture.edges.map((e) => `${e.from}->${e.to}`)).toEqual(['ui->chat', 'chat->kb'])
  })

  it('strips edge labels when labels are off', () => {
    expect(shape(architecture, { ...DEFAULT_VIEW, labels: false }).architecture.edges.every((e) => e.label === undefined)).toBe(true)
  })

  it('lays every component out left to right when asked', () => {
    const shaped = shape(architecture, { ...DEFAULT_VIEW, layout: 'left-right' })
    const at = shaped.architecture.layout ?? {}
    expect(shaped.sideways).toBe(true)
    expect(Object.keys(at).sort()).toEqual(ids(architecture).sort())
    expect(at.ui!.x).toBeLessThan(at.chat!.x)
    expect(at.chat!.x).toBeLessThan(at.kb!.x)
  })

  it('spreads components further apart when roomy', () => {
    const gap = (spacing: 'compact' | 'roomy') => {
      const at = shape(architecture, { ...DEFAULT_VIEW, spacing }).architecture.layout ?? {}
      return at.chat!.y - at.ui!.y
    }
    expect(gap('roomy')).toBeGreaterThan(gap('compact'))
  })

  it('groups components into bands by kind', () => {
    const at = shape(architecture, { ...DEFAULT_VIEW, group: true }).architecture.layout ?? {}
    expect(at.ui!.y).toBeLessThan(at.chat!.y)
    expect(at.chat!.y).toBe(at.kb!.y)
    expect(at.kb!.y).toBeLessThan(at.db!.y)
    expect(at.db!.y).toBeLessThan(at.llm!.y)
  })

  it('lights a focused component with its neighbours and dims the rest', () => {
    const shaped = shape(architecture, { ...DEFAULT_VIEW, focus: { components: ['kb'] } })
    expect(shaped.tone).toMatchObject({ kb: 'lit', chat: 'lit', db: 'lit', ui: 'dim', llm: 'dim', 'chat->kb': 'lit', 'kb->db': 'lit', 'ui->chat': 'dim', 'chat->llm': 'dim' })
    expect(shaped.fit.sort()).toEqual(['chat', 'db', 'kb'])
  })

  it('hides everything outside the focus when rest is hide', () => {
    const shaped = shape(architecture, { ...DEFAULT_VIEW, focus: { components: ['kb'], depth: 0, rest: 'hide' } })
    expect(ids(shaped.architecture)).toEqual(['kb'])
  })

  it('lights a path and keeps it visible even when its components are hidden', () => {
    const shaped = shape(architecture, { ...DEFAULT_VIEW, hide: ['chat'], path: { from: 'ui', to: 'kb' } })
    expect(ids(shaped.architecture)).toContain('chat')
    expect(shaped.tone).toMatchObject({ ui: 'lit', chat: 'lit', kb: 'lit', db: 'dim', 'ui->chat': 'lit', 'chat->kb': 'lit', 'kb->db': 'dim' })
  })

  it('ignores names that are no longer in the contract', () => {
    const shaped = shape(architecture, { ...DEFAULT_VIEW, hide: ['gone'], focus: { components: ['gone'], rest: 'hide' }, path: { from: 'gone', to: 'kb' } })
    expect(ids(shaped.architecture)).toEqual(ids(architecture))
    expect(shaped.tone).toEqual({})
  })
})
