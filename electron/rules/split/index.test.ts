import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { functionsIn, scan } from '../../scan/scan'
import { factsOf, type SourceFacts } from '../facts'
import { splitSuggestions, splitsIn } from '.'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const TWO = 'export function go() {}\nexport function stop() {}\n'

function source(file: string, text: string): SourceFacts {
  const facts = factsOf(file, () => text, (code) => functionsIn(code, file))
  if (!facts) throw new Error(`${file} is not code`)
  return facts
}

describe('splitSuggestions', () => {
  it('skips skipped files and files outside the scope, and sorts by path', () => {
    const sources = [source('b/two.ts', TWO), source('a/two.ts', TWO), source('a/two.test.ts', TWO), source('c/two.ts', TWO)]
    const found = splitSuggestions(undefined, sources, () => undefined)
    expect(found.map((split) => split.path)).toEqual(['a/two.ts', 'b/two.ts', 'c/two.ts'])
    expect(splitSuggestions(undefined, sources, () => undefined, 'b').map((split) => split.path)).toEqual(['b/two.ts'])
  })

  it('counts files already in the job folder', () => {
    const found = splitSuggestions(undefined, [source('a/two.ts', TWO), source('a/two/go.ts', 'export const x = 1\n')], () => undefined)
    expect(found[0]).toMatchObject({ kind: 'file', files: { count: 2, limit: 5 }, groups: [{ unnamed: 'a/two/go.ts already exists' }, { file: 'a/two/stop.ts' }] })
  })
})

describe('splitsIn', () => {
  it('reads the project from disk and keeps only the suggestions under a folder', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-split-'))
    roots.push(root)
    for (const file of ['a/two.ts', 'b/two.ts']) {
      fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true })
      fs.writeFileSync(path.join(root, file), TWO)
    }
    const map = await scan(root)
    expect(splitsIn(root, map, null).map((split) => split.path)).toEqual(['a/two.ts', 'b/two.ts'])
    expect(splitsIn(root, map, undefined, 'a').map((split) => split.path)).toEqual(['a/two.ts'])
    expect(splitsIn(root, map, { title: '', summary: '', components: [], edges: [], forbidden: [], packages: [], rules: [{ rule: 'jobs', limit: 'off', globs: [] }] })).toEqual([])
  })
})
