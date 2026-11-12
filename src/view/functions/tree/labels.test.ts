import { describe, expect, it } from 'vitest'
import type { FunctionRow } from '../../../../shared/types'
import { labelOf } from './labels'
import { PROJECT, UNREACHED, outlineOf } from './outline'

const row = (name: string, file: string): FunctionRow => ({
  file,
  name,
  line: 1,
  lines: 1,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: null,
  importance: 1,
})

describe('labelOf', () => {
  it('labels the project, a group, the unreached card, a bucket and a function from their counts', () => {
    const rows = Array.from({ length: 14 }, (_, at) => row(`fn${at}`, `src/${at % 2}.ts`))
    const outline = outlineOf({
      tree: {
        starts: [0],
        groups: [{ file: 'cli.ts', reason: 'bin', members: [0] }],
        unreached: rows.slice(1).map((_, at) => at + 1),
        children: rows.map(() => []),
        also: rows.map(() => 0),
      },
      rows,
      calls: rows.map((_, at) => (at === 1 ? [2] : [])),
      owners: {},
    })
    expect(labelOf(outline, PROJECT, rows, 'demo')).toEqual({ title: 'demo', notes: ['14 functions'] })
    expect(labelOf(outline, 'g:bin:cli.ts', rows, 'demo')).toEqual({
      title: 'package.json bin',
      notes: ['cli.ts', '1 function · 1 starting point'],
    })
    expect(labelOf(outline, UNREACHED, rows, 'demo')).toEqual({
      title: 'Not reached from a starting point',
      notes: ['13 functions'],
    })
    const [odd = ''] = outline.kids.get(UNREACHED) ?? []
    expect(labelOf(outline, odd, rows, 'demo')).toEqual({
      title: 'src/1.ts',
      tag: 'file',
      notes: ['7 functions · 0 starting points', '0 calls in · 1 out'],
    })
    expect(labelOf(outline, 'f3', rows, 'demo')).toEqual({ title: 'fn3', notes: [] })
  })
})
