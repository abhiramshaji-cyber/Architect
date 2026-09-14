import { describe, expect, it } from 'vitest'
import type { Architecture } from '../shared/types'
import { build, folderName, positions, roleOf, statusOf, type NodeData } from './layout'

function architecture(components: string[], edges: [string, string][]): Architecture {
  return {
    title: 'Test',
    summary: '',
    components: components.map((id) => ({ id, purpose: '', owns: [] })),
    edges: edges.map(([from, to]) => ({ from, to })),
    forbidden: [],
    packages: []
  }
}

function layout(a: Architecture) {
  const { nodes, links } = build(a, [])
  return positions(nodes, links)
}

describe('roleOf', () => {
  const a = architecture(['ui', 'api', 'db'], [
    ['ui', 'api'],
    ['api', 'db']
  ])

  it('calls a component nothing depends on an entry', () => {
    expect(roleOf('ui', a.edges)).toBe('entry')
  })

  it('calls a component that depends on nothing a foundation', () => {
    expect(roleOf('db', a.edges)).toBe('foundation')
  })

  it('leaves everything between unlabelled', () => {
    expect(roleOf('api', a.edges)).toBe('middle')
  })

  it('treats a component with no edges at all as an entry', () => {
    expect(roleOf('alone', [])).toBe('entry')
  })
})

describe('folderName', () => {
  it('uses the last path segment', () => {
    expect(folderName('/Users/x/repo/reporter/bot')).toBe('bot')
  })

  it('ignores a trailing separator', () => {
    expect(folderName('/Users/x/repo/reporter/bot/')).toBe('bot')
  })

  it('handles windows separators', () => {
    expect(folderName('C:\\Users\\x\\bot')).toBe('bot')
  })

  it('falls back to the root itself when there is no segment', () => {
    expect(folderName('/')).toBe('/')
  })
})

describe('statusOf', () => {
  const data = (over: Partial<NodeData>): NodeData => ({
    kind: 'component',
    label: 'a',
    purpose: '',
    owns: [],
    ghost: false,
    role: 'middle',
    badges: [],
    ...over
  })

  it('reports the role of a drawn component', () => {
    expect(statusOf(data({ role: 'entry' }))).toBe('entry')
  })

  it('reports a ghost as proposed', () => {
    expect(statusOf(data({ ghost: true }))).toBe('proposed')
  })

  it('reports an unowned file proposal as having no owner', () => {
    expect(statusOf(data({ kind: 'file', ghost: true, unassigned: true }))).toBe('no owner')
  })
})

describe('rank pinning', () => {
  it('puts every entry at the same height even when their depth differs', () => {
    const a = architecture(['ui', 'api', 'db', 'worker'], [
      ['ui', 'api'],
      ['api', 'db'],
      ['worker', 'db']
    ])

    const at = layout(a)
    expect(at.get('worker')!.y).toBe(at.get('ui')!.y)
  })

  it('puts every foundation at the same height even when their depth differs', () => {
    const a = architecture(['ui', 'api', 'db', 'config'], [
      ['ui', 'api'],
      ['ui', 'config'],
      ['api', 'db']
    ])

    const at = layout(a)
    expect(at.get('config')!.y).toBe(at.get('db')!.y)
  })

  it('keeps entries above the components that depend on them', () => {
    const a = architecture(['ui', 'api', 'db'], [
      ['ui', 'api'],
      ['api', 'db']
    ])

    const at = layout(a)
    expect(at.get('ui')!.y).toBeLessThan(at.get('api')!.y)
    expect(at.get('api')!.y).toBeLessThan(at.get('db')!.y)
  })

  it('starts the top rank at zero so every project opens at the same offset', () => {
    const a = architecture(['ui', 'api'], [['ui', 'api']])
    expect(layout(a).get('ui')!.y).toBe(0)
  })

  it('lays out an architecture with no components without throwing', () => {
    expect(layout(architecture([], [])).size).toBe(0)
  })

  it('lays out a cycle without throwing', () => {
    const a = architecture(['a', 'b'], [
      ['a', 'b'],
      ['b', 'a']
    ])
    expect(layout(a).size).toBe(2)
  })

  it('is deterministic: the same architecture lays out identically twice', () => {
    const a = architecture(['ui', 'api', 'db', 'worker'], [
      ['ui', 'api'],
      ['api', 'db'],
      ['worker', 'db']
    ])

    expect([...layout(a).entries()]).toEqual([...layout(a).entries()])
  })
})
