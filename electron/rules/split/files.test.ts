import { describe, expect, it } from 'vitest'
import type { RuleEntry } from '../../../shared/types'
import { functionsIn } from '../../scan/scan'
import { effective } from '../audit'
import { factsOf, type SourceFacts } from '../facts'
import { fileSplit } from './files'

function source(file: string, text: string): SourceFacts {
  const facts = factsOf(file, () => text, (code) => functionsIn(code, file))
  if (!facts) throw new Error(`${file} is not code`)
  return facts
}

const THREE = [
  'export function parseRules() {',
  '  return parseLine()',
  '}',
  'export function parseLine() {',
  '  return 1',
  '}',
  'export function ruleLine() {',
  '  return pad()',
  '}',
  'function pad() {',
  '  return 2',
  '}',
  'function loose() {}',
  'export function isEmpty() {}',
].join('\n')

const none = () => []

const split = (declared: RuleEntry[], file: SourceFacts, filesIn: (folder: string) => string[] = none) => fileSplit(effective(declared), file, filesIn)

describe('fileSplit', () => {
  it('suggests nothing for a file within its limits', () => {
    expect(split([], source('src/a.ts', 'export function a() {}\n'))).toBeNull()
  })

  it('puts each job group in a file named after it, in a folder behind the same entry', () => {
    const found = split([], source('src/syntax.ts', THREE))
    expect(found?.over).toEqual({ jobs: { count: 3, limit: 1 } })
    expect(found?.folder).toBe('src/syntax')
    expect(found?.entry).toBe('src/syntax.ts')
    expect(found?.groups.map((group) => [group.file, group.exported, group.members.map((member) => member.name), group.lines])).toEqual([
      ['src/syntax/parse.ts', ['parseRules', 'parseLine'], ['parseRules', 'parseLine'], 6],
      ['src/syntax/rule.ts', ['ruleLine'], ['ruleLine', 'pad'], 6],
      ['src/syntax/is.ts', ['isEmpty'], ['isEmpty'], 1],
    ])
    expect(found?.stays).toEqual({ lines: 1, functions: ['loose'] })
    expect(found?.files).toEqual({ count: 3, limit: 5 })
    expect(found?.blocked).toBeUndefined()
  })

  it('merges groups that take the same name into one file', () => {
    const found = split([], source('a.ts', 'export function loadA() {}\nexport function loadB() {}\nexport function save() {}\n'))
    expect(found?.groups.map((group) => [group.file, group.exported])).toEqual([
      ['a/load.ts', ['loadA', 'loadB']],
      ['a/save.ts', ['save']],
    ])
  })

  it('leaves a group unnamed with its tie, and one whose file already exists with that reason', () => {
    const tie = split([], source('a.ts', 'export function alignX() {\n  toY()\n}\nexport function toY() {}\nexport function zap() {}\n'))
    expect(tie?.groups[0]).toMatchObject({ unnamed: 'the leading words of the exported names tie: align x1, to x1', exported: ['alignX', 'toY'] })
    expect(tie?.groups[0]?.file).toBeUndefined()
    const taken = split([], source('a.ts', 'export function go() {}\nexport function stop() {}\n'), () => ['a/go.ts', 'a/x.ts', 'b/y.ts'])
    expect(taken?.groups[0]).toMatchObject({ unnamed: 'a/go.ts already exists' })
    expect(taken?.files).toEqual({ count: 3, limit: 5 })
  })

  it('splits an index file beside itself, counting itself and its siblings', () => {
    const found = split([], source('lib/index.ts', 'export function go() {}\nexport function stop() {}\n'), () => ['lib/index.ts', 'lib/other.ts'])
    expect(found?.folder).toBe('lib')
    expect(found?.groups.map((group) => group.file)).toEqual(['lib/go.ts', 'lib/stop.ts'])
    expect(found?.files).toEqual({ count: 4, limit: 5 })
    const self = split([], source('lib/index.ts', 'export function indexAll() {}\nexport function stop() {}\n'))
    expect(self?.groups[0]).toMatchObject({ unnamed: 'lib/index.ts already exists' })
  })

  it('reports a folder the split would overfill against the files rule there', () => {
    const found = split([{ rule: 'files', limit: 1, globs: ['a'] }], source('a.ts', 'export function go() {}\nexport function stop() {}\n'))
    expect(found?.files).toEqual({ count: 2, limit: 1 })
  })

  it('suggests for a file over the project wide limit even when a later line grandfathers it', () => {
    const grandfathered: RuleEntry[] = [{ rule: 'lines', limit: 300, globs: ['big.ts'] }]
    const found = split(grandfathered, source('big.ts', 'export function go() {}\nexport function stop() {}\n'.repeat(1) + 'x\n'.repeat(250)))
    expect(found?.over).toEqual({ lines: { count: 252, limit: 300, project: 200 }, jobs: { count: 2, limit: 1 } })
    expect(split([{ rule: 'lines', limit: 'off', globs: ['big.ts'] }, { rule: 'jobs', limit: 'off', globs: [] }], source('big.ts', 'x\n'.repeat(250)))).toBeNull()
    expect(split([{ rule: 'lines', limit: 'off', globs: [] }, { rule: 'lines', limit: 100, globs: ['big.ts'] }], source('big.ts', 'x\n'.repeat(150)))?.over).toEqual({ lines: { count: 150, limit: 100 } })
  })

  it('blocks a file with one job or none, saying why', () => {
    expect(split([], source('one.ts', 'export function go() {}\n' + 'x\n'.repeat(210)))?.blocked).toBe('every exported function sits in one connected group, so no job splits off')
    expect(split([], source('none.ts', 'x\n'.repeat(210)))?.blocked).toBe('no exported function to group into a job')
  })

  it('counts a nested member once in its group total', () => {
    const found = split([], source('a.ts', 'export function go() {\n  const inner = () => {\n    return 1\n  }\n  return inner()\n}\nexport function stop() {}\n'))
    expect(found?.groups[0]).toMatchObject({ members: [{ name: 'go', line: 1, endLine: 6 }, { name: 'inner', line: 2, endLine: 4 }], lines: 6 })
  })
})
