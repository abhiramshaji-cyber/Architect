import { describe, expect, it } from 'vitest'
import type { RuleEntry } from '../../shared/types'
import { functionsIn } from '../scan/scan'
import { auditRules } from './audit'
import { factsOf, type SourceFacts } from './facts'

function source(file: string, text: string): SourceFacts {
  const facts = factsOf(file, () => text, (code) => functionsIn(code, file))
  if (!facts) throw new Error(`${file} is not code`)
  return facts
}

const short = (file: string) => source(file, 'export const x = 1\n')

const rulesOf = (sources: SourceFacts[], declared?: RuleEntry[], scope?: string) =>
  auditRules(declared, sources, scope).map(({ rule, path, line, message }) => ({ rule, path, line, message }))

describe('lines', () => {
  it('reports a file over the default limit at the first line past it', () => {
    expect(rulesOf([source('a.ts', 'x\n'.repeat(201))])).toEqual([{ rule: 'lines', path: 'a.ts', line: 201, message: '201 lines, the limit is 200' }])
    expect(rulesOf([source('a.ts', 'x\n'.repeat(200))])).toEqual([])
  })

  it('lets the last matching line win', () => {
    const declared: RuleEntry[] = [
      { rule: 'lines', limit: 10, globs: [] },
      { rule: 'lines', limit: 'off', globs: ['big/**'] },
    ]
    expect(rulesOf([source('big/a.ts', 'x\n'.repeat(50)), source('b.ts', 'x\n'.repeat(11))], declared).map((v) => v.path)).toEqual(['b.ts'])
  })
})

describe('files', () => {
  it('counts code files per folder, leaving out tests by default', () => {
    const held = ['a', 'b', 'c', 'd', 'e'].map((name) => short(`src/${name}.ts`))
    expect(rulesOf([...held, short('src/a.test.ts'), short('src/a.spec.tsx')])).toEqual([])
    expect(rulesOf([...held, short('src/f.ts')])).toEqual([
      { rule: 'files', path: 'src', line: undefined, message: '6 code files, the limit is 5: a.ts, b.ts, c.ts, d.ts, e.ts, f.ts' },
    ])
  })

  it('names the project root as a dot and counts tests once skip is off', () => {
    const held = ['a', 'b', 'c', 'd', 'e'].map((name) => short(`${name}.ts`))
    const declared: RuleEntry[] = [{ rule: 'skip', globs: [] }]
    expect(rulesOf([...held, short('a.test.ts')], declared).map((v) => v.path)).toEqual(['.'])
    expect(rulesOf([...held, short('a.test.ts')], [...declared, { rule: 'files', limit: 6, globs: ['.'] }])).toEqual([])
  })
})

describe('names', () => {
  it('finds a banned word in a file, class, function or method name', () => {
    const text = 'export class UserManager {\n  createHelper() {}\n}\nexport function makeFactory() {}\n'
    expect(rulesOf([source('src/user-service.ts', text)]).map((v) => `${v.line}: ${v.message}`)).toEqual([
      'undefined: file user-service uses the banned word Service',
      '1: class UserManager uses the banned word Manager',
      '2: function createHelper uses the banned word Helper',
      '4: function makeFactory uses the banned word Factory',
    ])
  })

  it.each([['Database'], ['toBase64'], ['basement'], ['servicesLeft']])('leaves %s alone, the word is only part of another', (name) => {
    expect(rulesOf([source('a.ts', `export function ${name}() {}\n`)])).toEqual([])
  })

  it.each([['baseUrl'], ['HTTPService'], ['fetch_service'], ['BASE']])('catches %s', (name) => {
    expect(rulesOf([source('a.ts', `export function ${name}() {}\n`)])).toHaveLength(1)
  })

  it('takes its word list and switch from the Rules section', () => {
    const text = 'function userService() {}\nfunction cacheStore() {}\n'
    expect(rulesOf([source('a.ts', text)], [{ rule: 'names', banned: ['Store'], globs: [] }]).map((v) => v.line)).toEqual([2])
    expect(rulesOf([source('a.ts', text)], [{ rule: 'names', banned: 'off', globs: [] }])).toEqual([])
  })
})

describe('jobs', () => {
  it('reports unrelated exported functions at the first one past the limit', () => {
    const text = 'export function a() {}\n\nexport function b() {}\n\nexport function c() {\n  return a()\n}\n'
    expect(rulesOf([source('a.ts', text)])).toEqual([
      { rule: 'jobs', path: 'a.ts', line: 3, message: '2 unrelated groups of exported functions with no calls between them, the limit is 1: a, c (line 1); b (line 3)' },
    ])
    expect(rulesOf([source('a.ts', text)], [{ rule: 'jobs', limit: 2, globs: [] }])).toEqual([])
  })

  it('relates exported functions through a shared private function', () => {
    const text = 'function shared() {}\nexport function a() {\n  shared()\n}\nexport function b() {\n  shared()\n}\n'
    expect(rulesOf([source('a.ts', text)])).toEqual([])
  })

  it('relates exported functions through a nested function', () => {
    const text = 'function shared() {}\nexport function a() {\n  const inner = () => shared()\n  return inner\n}\nexport const b = () => shared()\n'
    expect(rulesOf([source('a.ts', text)])).toEqual([])
  })

  it('counts top level functions only, not methods of an exported class or object', () => {
    const text = 'export class A {\n  one() {}\n  two() {}\n}\nexport const api = { three() {}, four() {} }\nexport function go() {}\n'
    expect(rulesOf([source('a.ts', text)])).toEqual([])
  })

  it('counts each component as a job', () => {
    const text = 'export function Header() {\n  return <h1 />\n}\nexport function Footer() {\n  return <p />\n}\n'
    expect(rulesOf([source('a.tsx', text)]).map((v) => v.rule)).toEqual(['jobs'])
  })
})

describe('auditRules', () => {
  it('checks only files inside the scope', () => {
    expect(rulesOf([source('docs/a.ts', 'x\n'.repeat(300)), short('app/b.ts')], undefined, 'app')).toEqual([])
  })

  it('leaves out a skipped file entirely', () => {
    expect(rulesOf([source('gen/huge.ts', 'x\n'.repeat(900))], [{ rule: 'skip', globs: ['gen/**'] }])).toEqual([])
  })
})
