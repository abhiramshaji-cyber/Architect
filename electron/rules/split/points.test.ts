import { describe, expect, it } from 'vitest'
import { functionsIn } from '../../scan/scan'
import { parsed } from '../facts'
import { pointsOf } from './points'

function pointsIn(text: string, name: string, file = 'a.ts') {
  const functions = functionsIn(text, file)
  const fn = functions.find((entry) => entry.name === name)
  if (!fn) throw new Error(`no ${name}`)
  const found = pointsOf(parsed(text, file), fn, functions)
  return typeof found === 'string' ? found : found.map((point) => `${point.kind} ${point.label} ${point.line}-${point.endLine} ${point.lines}`)
}

const BIG = [
  'export function big(items: number[]) {',
  '  const visit = (n: number) => {',
  '    return n + 1',
  '  }',
  '  if (items.length === 0) {',
  '    return 0',
  '  }',
  '  for (const item of items) {',
  '    visit(item)',
  '  }',
  '  items.forEach((item) => {',
  '    visit(item)',
  '  })',
  '  const total = items.reduce((sum, item) => sum + item, 0)',
  '  if (total) return total',
  '  return items.length',
  '}',
].join('\n')

describe('pointsOf', () => {
  it('lists inner functions, multi line compound statements and block callbacks at the top of the body', () => {
    expect(pointsIn(BIG, 'big')).toEqual(['function visit 2-4 3', 'if if 5-7 3', 'for of for of 8-10 3', 'callback items.forEach callback 11-13 3'])
  })

  it('finds the body of an arrow assigned to a const and of a method', () => {
    const arrow = 'export const go = async () => {\n  try {\n    await run()\n  } catch {}\n  return 1\n}\n'
    expect(pointsIn(arrow, 'go')).toEqual(['try try 2-4 3'])
    const method = 'class A {\n  run() {\n    while (true) {\n      break\n    }\n    return 1\n  }\n}\n'
    expect(pointsIn(method, 'A.run')).toEqual(['while while 3-5 3'])
  })

  it('labels a callback passed to a computed callee as a call', () => {
    const curried = 'export function go() {\n  make(1)(() => {\n    run()\n  })\n  return 1\n}\n'
    expect(pointsIn(curried, 'go')).toEqual(['callback call callback 2-4 3'])
  })

  it('says why when the parse shows no point', () => {
    expect(pointsIn('export const one = () => {\n  return [\n    1,\n  ]\n}\n', 'one')).toBe('the body is one statement')
    expect(pointsIn('export function flat() {\n  const a = 1\n  return a\n}\n', 'flat')).toBe('no compound statement, callback or inner function in the body')
    expect(pointsIn('export const id = (x: number) =>\n  x\n', 'id')).toBe('no block body found in the parse')
  })

  it('still lists inner functions when the body is one statement or cannot be parsed', () => {
    const one = 'export function outer() {\n  function inner() {\n    return 1\n  }\n}\n'
    expect(pointsIn(one, 'outer')).toEqual(['function inner 2-4 3'])
    const fn = functionsIn(BIG, 'a.ts').find((entry) => entry.name === 'big')
    if (!fn) throw new Error('no big')
    expect(pointsOf(undefined, fn, functionsIn(BIG, 'a.ts'))).toEqual([{ kind: 'function', label: 'visit', line: 2, endLine: 4, lines: 3 }])
  })
})
