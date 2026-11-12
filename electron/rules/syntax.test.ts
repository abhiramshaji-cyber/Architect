import { describe, expect, it } from 'vitest'
import { parseRules, ruleLine } from './syntax'

function read(...texts: string[]) {
  const problems: string[] = []
  const entries = parseRules(
    texts.map((text, i) => ({ text, line: i + 1, col: 0 })),
    (message) => problems.push(message),
  )
  return { entries, problems }
}

describe('split rule', () => {
  it('reads both thresholds with globs, and off', () => {
    expect(read('- split: 50 lines, 3 callers', '- split: 1 line, 1 caller `src/**`', '- split: off `gen/**`')).toEqual({
      entries: [
        { rule: 'split', threshold: { lines: 50, callers: 3 }, globs: [] },
        { rule: 'split', threshold: { lines: 1, callers: 1 }, globs: ['src/**'] },
        { rule: 'split', threshold: 'off', globs: ['gen/**'] },
      ],
      problems: [],
    })
  })

  it('refuses a missing, zero, reordered or oversized threshold', () => {
    const bad = 'split takes "<n> lines, <n> callers" with both above zero, or off'
    for (const value of ['50', '0 lines, 3 callers', '50 lines, 0 callers', '3 callers, 50 lines', '99999999999999999999 lines, 3 callers', '50 lines 3 callers']) {
      expect(read(`- split: ${value}`).problems).toEqual([`${bad} (line 1)`])
    }
  })

  it('writes a split line back the way it reads', () => {
    expect(ruleLine({ rule: 'split', threshold: { lines: 50, callers: 3 }, globs: ['a/**'] })).toBe('- split: 50 lines, 3 callers `a/**`')
    expect(ruleLine({ rule: 'split', threshold: 'off', globs: [] })).toBe('- split: off')
  })
})

describe('parseRules', () => {
  it('reads every rule with its value and globs', () => {
    expect(read('- lines: 300 `src/a.ts`, `src/b.ts`', '- files: off', '- names: Manager, Helper', '- jobs: 2', '- skip: `**/*.test.ts`')).toEqual({
      entries: [
        { rule: 'lines', limit: 300, globs: ['src/a.ts', 'src/b.ts'] },
        { rule: 'files', limit: 'off', globs: [] },
        { rule: 'names', banned: ['Manager', 'Helper'], globs: [] },
        { rule: 'jobs', limit: 2, globs: [] },
        { rule: 'skip', globs: ['**/*.test.ts'] },
      ],
      problems: [],
    })
  })

  it('reads off for names and skip', () => {
    expect(read('- names: off `a/**`', '- skip: off').entries).toEqual([
      { rule: 'names', banned: 'off', globs: ['a/**'] },
      { rule: 'skip', globs: [] },
    ])
  })

  it.each([
    ['lines 200', 'malformed rule'],
    ['- sizes: 3', 'unknown rule "sizes"'],
    ['- lines: 0', 'whole number above zero'],
    ['- lines: -1', 'whole number above zero'],
    ['- lines: 1.5', 'whole number above zero'],
    ['- files: many', 'whole number above zero'],
    ['- lines: 200 junk', 'whole number above zero'],
    ['- names:', 'comma separated list'],
    ['- names: Big Base', 'comma separated list'],
    ['- skip: tests', 'backticked globs'],
    ['- skip:', 'backticked globs'],
    ['- jobs: 2 ``', 'empty glob'],
  ])('reports %s', (text, problem) => {
    const { entries, problems } = read(text)
    expect(entries).toEqual([])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(problem)
  })
})
