import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hashOf, hit, readCache, writeCache, type RankCache } from './cache'

const dirs: string[] = []

function temp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-ranks-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const ranks = [{ importance: 3 as const, summary: 'Saves your work.' }]

describe('hit', () => {
  const cache: RankCache = {
    'a.ts': { hash: hashOf('one'), keys: ['save:1'], ranks },
  }

  it('returns the stored ranks when the content and the functions match', () => {
    expect(hit(cache, 'a.ts', hashOf('one'), ['save:1'])).toEqual(ranks)
  })

  it('misses on changed content, changed functions, or an unknown file', () => {
    expect(hit(cache, 'a.ts', hashOf('two'), ['save:1'])).toBeNull()
    expect(hit(cache, 'a.ts', hashOf('one'), ['save:2'])).toBeNull()
    expect(hit(cache, 'a.ts', hashOf('one'), ['save:1', 'load:4'])).toBeNull()
    expect(hit(cache, 'b.ts', hashOf('one'), ['save:1'])).toBeNull()
  })
})

describe('readCache and writeCache', () => {
  it('round trips through disk, creating the folder', () => {
    const file = path.join(temp(), 'nested', 'ranks.json')
    const cache: RankCache = { 'a.ts': { hash: 'h', keys: ['save:1'], ranks } }
    writeCache(file, cache)
    expect(readCache(file)).toEqual(cache)
  })

  it('starts empty when the file is missing or corrupt, and drops malformed entries', () => {
    const dir = temp()
    expect(readCache(path.join(dir, 'missing.json'))).toEqual({})

    const corrupt = path.join(dir, 'corrupt.json')
    fs.writeFileSync(corrupt, '{nope')
    expect(readCache(corrupt)).toEqual({})

    const mixed = path.join(dir, 'mixed.json')
    fs.writeFileSync(
      mixed,
      JSON.stringify({
        'good.ts': { hash: 'h', keys: ['a:1'], ranks },
        'short.ts': { hash: 'h', keys: ['a:1', 'b:2'], ranks },
        'bad.ts': {
          hash: 'h',
          keys: ['a:1'],
          ranks: [{ importance: 9, summary: 'x' }],
        },
        'junk.ts': 4,
      }),
    )
    expect(Object.keys(readCache(mixed))).toEqual(['good.ts'])
  })
})
