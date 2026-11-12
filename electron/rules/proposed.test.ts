import { describe, expect, it } from 'vitest'
import { functionsIn } from '../scan/scan'
import { factsOf, type SourceFacts } from './facts'
import { proposedViolations } from './proposed'

function source(file: string, text: string): SourceFacts {
  const facts = factsOf(file, () => text, (code) => functionsIn(code, file))
  if (!facts) throw new Error(`${file} is not code`)
  return facts
}

const rulesOf = (siblings: string[], before: SourceFacts | null, after: SourceFacts) =>
  proposedViolations(undefined, undefined, siblings, before, after).map((v) => `${v.rule} ${v.path}`)

describe('proposedViolations', () => {
  it('reports what the change adds, and nothing it inherits unchanged or improved', () => {
    const before = source('a.ts', 'x\n'.repeat(260))
    expect(rulesOf(['a.ts'], before, source('a.ts', 'x\n'.repeat(250)))).toEqual([])
    expect(rulesOf(['a.ts'], before, source('a.ts', 'x\n'.repeat(260)))).toEqual([])
    expect(rulesOf(['a.ts'], before, source('a.ts', 'x\n'.repeat(261)))).toEqual(['lines a.ts'])
    expect(rulesOf([], null, source('a.ts', 'x\n'.repeat(201)))).toEqual(['lines a.ts'])
  })

  it('reports only a banned name the change introduces', () => {
    const before = source('a.ts', 'function userService() {}\n')
    expect(rulesOf(['a.ts'], before, source('a.ts', 'function userService() {}\nfunction go() {}\n'))).toEqual([])
    expect(rulesOf(['a.ts'], before, source('a.ts', 'function userService() {}\nfunction cacheHelper() {}\n'))).toEqual(['names a.ts'])
  })

  it('reports a job split only when it grows', () => {
    const two = 'export function a() {}\nexport function b() {}\n'
    expect(rulesOf(['a.ts'], source('a.ts', two), source('a.ts', `${two}export function c() {\n  a()\n}\n`))).toEqual([])
    expect(rulesOf(['a.ts'], source('a.ts', two), source('a.ts', `${two}export function c() {}\n`))).toEqual(['jobs a.ts'])
  })

  it('counts code siblings toward the folder, not notes or tests, and ignores violations of other files', () => {
    const siblings = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/UserService.ts', 'src/README.md', 'src/a.test.ts']
    expect(rulesOf(siblings, null, source('src/d.ts', 'export const x = 1\n'))).toEqual([])
    expect(rulesOf([...siblings, 'src/d.ts'], null, source('src/e.ts', 'export const x = 1\n'))).toEqual(['files src'])
    expect(rulesOf([...siblings, 'src/d.ts', 'src/e.ts'], source('src/a.ts', ''), source('src/a.ts', 'export const x = 1\n'))).toEqual([])
  })
})
