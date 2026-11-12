import { describe, expect, it } from 'vitest'
import type { FunctionRow } from '../../../../shared/types'
import { nest } from '../layout/nest'
import { styleShade } from './style'

const row = (over: Partial<FunctionRow>): FunctionRow => ({
  file: 'a/one.ts',
  name: 'x',
  line: 1,
  lines: 5,
  fanIn: 0,
  fanOut: 0,
  exported: false,
  entry: null,
  importance: 1,
  ...over,
})

const fail = { rule: 'lines' as const, message: 'too long', grandfathered: false }

describe('styleShade', () => {
  const tree = nest(
    [row({}), row({ file: 'a/two.ts' }), row({ file: 'a/x.test.ts' })],
    [
      { path: 'a/one.ts', lines: 9, code: true },
      { path: 'a/three.ts', lines: 0, code: true },
    ],
    null,
    'demo',
  )
  const ids = (label: string) => {
    const stack = [tree]
    while (stack.length) {
      const node = stack.pop()
      if (node?.label === label) return node.id
      stack.push(...(node?.children ?? []))
    }
    throw new Error(label)
  }

  it('fails a file and everything inside it, and shares failures by file count up the tree', () => {
    const style = new Map([
      ['a/one.ts', [fail]],
      ['a/two.ts', []],
      ['a/three.ts', []],
    ])
    const values = styleShade(tree, style)
    expect(values.get(ids('one.ts'))).toBe(1)
    expect(values.get(ids('outside functions'))).toBe(1)
    expect(values.get(ids('two.ts'))).toBe(0)
    expect(values.get(ids('x.test.ts'))).toBeNull()
    expect(values.get(ids('a'))).toBeCloseTo(1 / 3)
    expect(values.get(tree.id)).toBeCloseTo(1 / 3)
  })

  it('leaves everything uncoloured before the rules are read', () => {
    expect([...styleShade(tree, null).values()].every((value) => value === null)).toBe(true)
  })
})
