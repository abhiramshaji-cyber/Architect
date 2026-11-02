import { describe, expect, it } from 'vitest'
import type { FunctionFacts } from '../../shared/types'
import { LINE_CHARS, parseRanks, promptFor, SOURCE_LINES, sourceOf } from './prompt'

const facts = (over: Partial<FunctionFacts> = {}): FunctionFacts => ({
  file: 'a.ts',
  name: 'save',
  line: 1,
  lines: 3,
  fanIn: 2,
  fanOut: 1,
  exported: true,
  entry: false,
  ...over,
})

describe('parseRanks', () => {
  it('reads a clean array and a reply wrapped in prose and a fence', () => {
    const body =
      '[{"id":"f0","importance":5,"summary":"Saves your work."},{"id":"f1","importance":1,"summary":"Adds two numbers."}]'
    const expected = new Map([
      ['f0', { importance: 5, summary: 'Saves your work.' }],
      ['f1', { importance: 1, summary: 'Adds two numbers.' }],
    ])
    expect(parseRanks(body, ['f0', 'f1'])).toEqual(expected)
    expect(parseRanks(`Here you go:\n\`\`\`json\n${body}\n\`\`\``, ['f0', 'f1'])).toEqual(expected)
  })

  it('drops unknown ids, keeps the first of a duplicate and collapses whitespace', () => {
    const body = JSON.stringify([
      { id: 'f9', importance: 3, summary: 'Ghost.' },
      { id: 'f0', importance: 4, summary: '  Keeps\n the   list. ' },
      { id: 'f0', importance: 1, summary: 'Second.' },
    ])
    expect(parseRanks(body, ['f0'])).toEqual(new Map([['f0', { importance: 4, summary: 'Keeps the list.' }]]))
  })

  it('rejects an importance outside 1 to 5 or not whole, and an empty summary', () => {
    const body = JSON.stringify([
      { id: 'f0', importance: 0, summary: 'a' },
      { id: 'f1', importance: 6, summary: 'b' },
      { id: 'f2', importance: 2.5, summary: 'c' },
      { id: 'f3', importance: '4', summary: 'd' },
      { id: 'f4', importance: 3, summary: '   ' },
      { id: 'f5', importance: 3 },
      null,
      'f6',
    ])
    expect(parseRanks(body, ['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6'])).toEqual(
      new Map([['f3', { importance: 4, summary: 'd' }]]),
    )
  })

  it('returns nothing for malformed JSON, an object or no array at all', () => {
    expect(parseRanks('[{"id":"f0",', ['f0']).size).toBe(0)
    expect(parseRanks('{"f0": 3}', ['f0']).size).toBe(0)
    expect(parseRanks('', ['f0']).size).toBe(0)
  })
})

describe('sourceOf', () => {
  it('caps the lines and the width of each line it sends', () => {
    const lines = Array.from({ length: SOURCE_LINES + 20 }, (_, i) => `${i}`.padEnd(LINE_CHARS + 40, 'x'))
    const text = sourceOf(lines, facts({ line: 1, lines: SOURCE_LINES + 20 }))
    const sent = text.split('\n')
    expect(sent).toHaveLength(SOURCE_LINES)
    expect(sent.every((line) => line.length === LINE_CHARS)).toBe(true)
  })

  it('sends only the function span when it is shorter than the cap', () => {
    expect(sourceOf(['a', 'b', 'c', 'd'], facts({ line: 2, lines: 2 }))).toBe('b\nc')
  })
})

describe('promptFor', () => {
  it('carries every function with its facts and escapes quotes in names', () => {
    const prompt = promptFor('demo', 'a.ts', [
      { id: 'f0', facts: facts(), source: 'function save() {}' },
      {
        id: 'f1',
        facts: facts({ name: 'api["x"]', fanIn: 0, exported: false }),
        source: '',
      },
    ])
    expect(prompt).toContain('id="f0" name="save" lines="3" called-by="2" calls="1" exported="yes"')
    expect(prompt).toContain(`id="f1" name="api['x']"`)
    expect(prompt).toContain('Other files in the project load this file.')
  })
})
