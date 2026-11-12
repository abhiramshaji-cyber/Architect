import { describe, expect, it } from 'vitest'
import { factsOf } from './facts'

const none = () => []

describe('factsOf', () => {
  it('skips files that are not code, declarations and unreadable files', () => {
    expect(factsOf('README.md', () => '# hi', none)).toBeNull()
    expect(factsOf('types/global.d.ts', () => 'declare const x: 1', none)).toBeNull()
    expect(factsOf('src/a.ts', () => undefined, none)).toBeNull()
  })

  it.each([
    ['', 0],
    ['one', 1],
    ['one\n', 1],
    ['one\ntwo', 2],
    ['one\r\ntwo\r\n', 2],
    ['\n\n', 2],
  ])('counts the lines of %j as %i', (text, lines) => {
    expect(factsOf('a.ts', () => text, none)?.lines).toBe(lines)
  })

  it('finds every named class with its line, nested and in tsx', () => {
    const text = 'export class A {}\nfunction f() {\n  return class B {}\n}\nconst C = class {}\n'
    expect(factsOf('a.ts', () => text, none)?.classes).toEqual([
      { name: 'A', line: 1 },
      { name: 'B', line: 3 },
    ])
    expect(factsOf('a.tsx', () => 'export class View {\n  render() { return <div /> }\n}\n', none)?.classes).toEqual([{ name: 'View', line: 1 }])
  })

  it('measures code in languages it does not parse by lines alone', () => {
    expect(factsOf('tool.py', () => 'class Thing:\n  pass\n', none)).toEqual({ path: 'tool.py', lines: 2, functions: [], classes: [] })
  })

  it('hands the text to the function reader', () => {
    const seen: string[] = []
    factsOf('a.ts', () => 'x', (text) => {
      seen.push(text)
      return []
    })
    expect(seen).toEqual(['x'])
  })
})
