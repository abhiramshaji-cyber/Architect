import { describe, expect, it } from 'vitest'
import type { FunctionRow } from '../../../../shared/types'
import { nest } from '../layout/nest'
import { scoreOf } from './score'

const row = (file: string): FunctionRow => ({
  file,
  name: 'x',
  line: 1,
  lines: 3,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: null,
  importance: 1,
})

describe('scoreOf', () => {
  const tree = nest([row('a/one.ts'), row('a/two.ts'), row('a/three.ts'), row('a/one.test.ts')], [], null, 'demo')
  const group = tree.children[0]

  it('is passing files over checked files, with a pass count per rule and the failing files sorted', () => {
    const style = new Map([
      ['a/two.ts', [{ rule: 'jobs' as const, line: 4, message: 'm', grandfathered: false }]],
      [
        'a/one.ts',
        [
          { rule: 'lines' as const, message: 'm', grandfathered: true },
          { rule: 'files' as const, message: 'm', grandfathered: false },
        ],
      ],
      ['a/three.ts', []],
    ])
    const score = group ? scoreOf(group, style) : null
    expect(score).toMatchObject({ files: 3, passing: 1, percent: 33, rules: { lines: 2, files: 2, names: 3, jobs: 2 } })
    expect(score?.failing.map((file) => file.path)).toEqual(['a/one.ts', 'a/two.ts'])
  })

  it('rounds down so a single failure never shows 100%, and counts an empty group as passing', () => {
    const many = nest(
      Array.from({ length: 300 }, (_, at) => row(`b/f${at}.ts`)),
      [],
      null,
      'demo',
    )
    const style = new Map(
      Array.from({ length: 300 }, (_, at) => [
        `b/f${at}.ts`,
        at === 0 ? [{ rule: 'names' as const, message: 'm', grandfathered: false }] : [],
      ]),
    )
    const top = many.children[0]
    expect(top ? scoreOf(top, style).percent : null).toBe(99)
    expect(group ? scoreOf(group, new Map()) : null).toMatchObject({ files: 0, passing: 0, percent: 100 })
  })
})
