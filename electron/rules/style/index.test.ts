import { describe, expect, it } from 'vitest'
import type { RuleEntry } from '../../../shared/types'
import { functionsIn } from '../../scan/scan'
import { factsOf, type SourceFacts } from '../facts'
import { styleOf } from '.'

function source(file: string, text: string): SourceFacts {
  const facts = factsOf(file, () => text, (code) => functionsIn(code, file))
  if (!facts) throw new Error(`${file} is not code`)
  return facts
}

const short = (file: string) => source(file, 'export const x = 1\n')
const long = (file: string, lines: number) => source(file, 'x\n'.repeat(lines))
const failing = (found: ReturnType<typeof styleOf>, path: string) => found.find((file) => file.path === path)?.failing

describe('styleOf', () => {
  it('lists every considered file, passing ones with nothing failing', () => {
    const found = styleOf(undefined, [short('a.ts'), short('a.test.ts'), long('b.ts', 201)])
    expect(found.map((file) => file.path)).toEqual(['a.ts', 'b.ts'])
    expect(failing(found, 'a.ts')).toEqual([])
    expect(failing(found, 'b.ts')).toEqual([{ rule: 'lines', line: 201, message: '201 lines, the limit is 200', grandfathered: false }])
  })

  it('counts a grandfathered limit as a failure against the base rule', () => {
    const declared: RuleEntry[] = [{ rule: 'lines', limit: 300, globs: ['big.ts', 'huge.ts'] }]
    const found = styleOf(declared, [long('big.ts', 250), long('huge.ts', 320)])
    expect(failing(found, 'big.ts')).toEqual([{ rule: 'lines', line: 201, message: '250 lines, the limit is 200', grandfathered: true }])
    expect(failing(found, 'huge.ts')).toEqual([{ rule: 'lines', line: 301, message: '320 lines, the limit is 300', grandfathered: false }])
  })

  it('keeps a stricter scoped limit', () => {
    const declared: RuleEntry[] = [{ rule: 'lines', limit: 50, globs: ['tight/**'] }]
    expect(failing(styleOf(declared, [long('tight/a.ts', 60)]), 'tight/a.ts')?.map((f) => f.grandfathered)).toEqual([false])
  })

  it('fails every file in a folder over the files limit, grandfathered or not', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => short(`wide/${name}.ts`))
    const plain = styleOf(undefined, six)
    expect(plain.every((file) => file.failing.length === 1 && file.failing[0]?.rule === 'files' && !file.failing[0].grandfathered)).toBe(true)
    const allowed = styleOf([{ rule: 'files', limit: 6, globs: ['wide'] }], six)
    expect(allowed.every((file) => file.failing[0]?.grandfathered === true)).toBe(true)
    const root = styleOf(undefined, ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => short(`${name}.ts`)))
    expect(root.every((file) => file.failing[0]?.rule === 'files')).toBe(true)
  })

  it('counts a word an override lets through as grandfathered', () => {
    const declared: RuleEntry[] = [{ rule: 'names', banned: ['Manager'], globs: ['base.ts'] }]
    const found = styleOf(declared, [source('base.ts', 'export function makeBase() {}\n')])
    expect(failing(found, 'base.ts')?.map(({ rule, grandfathered }) => [rule, grandfathered])).toEqual([
      ['names', true],
      ['names', true],
    ])
  })

  it('stays inside the scope and turns a rule off cleanly', () => {
    const found = styleOf([{ rule: 'lines', limit: 'off', globs: [] }], [long('in/a.ts', 500), long('out/b.ts', 500)], 'in')
    expect(found).toEqual([{ path: 'in/a.ts', failing: [] }])
  })
})
