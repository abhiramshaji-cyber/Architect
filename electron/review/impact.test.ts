import { describe, expect, it } from 'vitest'
import type { Architecture, FunctionRow, ReviewItem } from '../../shared/types'
import { detailOf, functionImpact, ownersOf } from './impact'

const before = `export function keep() {
  return 1
}

export function edit() {
  return 1
}

function gone() {}
`

const after = `
export function keep() {
  return 1
}

export function edit() {
  return 2
}

export function fresh() {}
`

const row = (name: string, fanIn: number): FunctionRow => ({
  file: 'src/a.ts',
  name,
  line: 1,
  lines: 3,
  fanIn,
  fanOut: 0,
  exported: true,
  entry: false,
  importance: 4,
  summary: '',
})

const architecture: Architecture = {
  title: 'T',
  summary: 'S',
  components: [
    { id: 'api', purpose: 'p', owns: ['src/**'] },
    { id: 'db', purpose: 'p', owns: ['src/a.ts', 'db/**'] },
  ],
  edges: [],
  forbidden: [],
  packages: [],
}

describe('functionImpact', () => {
  it('names functions added, changed and removed, and ignores one that only moved', () => {
    const impact = functionImpact('src/a.ts', before, after, [row('edit', 7), row('edit', 1), row('other', 2)])
    expect(impact).toEqual([
      { name: 'edit', change: 'changed', line: 6, fanIn: 7, importance: 4 },
      { name: 'fresh', change: 'added', line: 10, fanIn: null, importance: null },
      { name: 'gone', change: 'removed', line: 9, fanIn: null, importance: null },
    ])
  })

  it('reports every function of a new file as added', () => {
    expect(functionImpact('src/a.ts', '', 'function one() {}\n', []).map((f) => f.change)).toEqual(['added'])
  })

  it('finds nothing in a file it cannot parse for functions', () => {
    expect(functionImpact('notes.md', 'a', 'b', [])).toEqual([])
  })
})

describe('ownersOf', () => {
  it('lists every component claiming the file', () => {
    expect(ownersOf('src/a.ts', architecture)).toEqual(['api', 'db'])
    expect(ownersOf('src/b.ts', architecture)).toEqual(['api'])
    expect(ownersOf('lib/c.ts', architecture)).toEqual([])
    expect(ownersOf('src/a.ts', null)).toEqual([])
  })
})

describe('detailOf', () => {
  const proposal = (value: Extract<ReviewItem, { kind: 'proposal' }>['proposal']): ReviewItem => ({
    kind: 'proposal',
    id: '1',
    root: '/p',
    at: 0,
    proposal: value,
    rationale: 'r',
  })

  it('shows the architecture after a proposal and the architect.md diff', async () => {
    const detail = await detailOf(proposal({ kind: 'edge', from: 'api', to: 'db' }), null, architecture, [])
    expect(detail.after?.edges).toEqual([{ from: 'api', to: 'db' }])
    expect(detail.file).toBe('architect.md')
    expect(detail.error).toBeNull()
    expect(detail.hunks.flatMap((h) => h.rows).some((r) => r.new?.text === '- api -> db' && !r.context)).toBe(true)
  })

  it('points a package proposal at its component', async () => {
    const detail = await detailOf(proposal({ kind: 'package', name: 'zod', component: 'db' }), null, architecture, [])
    expect(detail.owners).toEqual(['db'])
  })

  it('explains a proposal that no longer applies', async () => {
    const detail = await detailOf(proposal({ kind: 'remove_component', id: 'nope' }), null, architecture, [])
    expect(detail.after).toBeNull()
    expect(detail.error).toMatch(/unknown component/)
  })

  it('shows a code edit on its owners with its functions and diff', async () => {
    const item: ReviewItem = { kind: 'code', id: '2', root: '/p', at: 0, file: 'src/a.ts', tool: 'Edit' }
    const detail = await detailOf(item, { before, after }, architecture, [])
    expect(detail.owners).toEqual(['api', 'db'])
    expect(detail.functions.map((f) => f.name)).toEqual(['edit', 'fresh', 'gone'])
    expect(detail.hunks.length).toBeGreaterThan(0)
  })
})
