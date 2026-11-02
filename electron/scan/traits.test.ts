import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FunctionEntry } from '../../shared/types'
import { scan } from './scan'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function scanned(file: string, text: string): Promise<Record<string, FunctionEntry>> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-traits-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, file), text)
  const map = await scan(root)
  const entries = map.folders.flatMap((folder) => folder.files).flatMap((f) => f.functions)
  return Object.fromEntries(entries.map((fn) => [fn.name, fn]))
}

describe('doc', () => {
  it('keeps the first sentence of a doc comment, without tags or links', async () => {
    const by = await scanned(
      'a.ts',
      [
        '/**',
        ' * Loads the {@link Config} from `disk`. Falls back to defaults.',
        ' * @param root where to look',
        ' */',
        'export function load(root: string) {}',
      ].join('\n'),
    )
    expect(by.load?.doc).toBe('Loads the Config from disk.')
  })

  it('reads line comments directly above an arrow constant and adds a full stop', async () => {
    const by = await scanned('a.ts', '// works out the total price\nconst total = () => 1\n')
    expect(by.total?.doc).toBe('Works out the total price.')
  })

  it('ignores labels, directives, code and comments separated by a blank line', async () => {
    const by = await scanned(
      'a.ts',
      [
        '// fetch-user',
        'function a() {}',
        '// eslint-disable-next-line no-console',
        'function b() {}',
        '// const old = run();',
        'function c() {}',
        '// Something unrelated here.',
        '',
        'function d() {}',
        'function e() {}',
      ].join('\n'),
    )
    expect([by.a?.doc, by.b?.doc, by.c?.doc, by.d?.doc, by.e?.doc]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })

  it('caps a long first sentence at twenty words', async () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ')
    const by = await scanned('a.ts', `/** ${words}. */\nfunction long() {}\n`)
    expect(by.long?.doc?.split(' ')).toHaveLength(20)
    expect(by.long?.doc?.endsWith('…')).toBe(true)
  })
})

describe('kind', () => {
  it('tells components, constructors, getters, setters and methods apart', async () => {
    const by = await scanned(
      'a.tsx',
      [
        'export function Card() { return <div /> }',
        'const List = () => <><Card /></>',
        'class Store {',
        '  constructor() {}',
        '  get size() { return 1 }',
        '  set label(v: string) {}',
        '  save() {}',
        '}',
        'function plain() { return 1 }',
      ].join('\n'),
    )
    expect(by.Card?.kind).toBe('component')
    expect(by.List?.kind).toBe('component')
    expect(by['Store.constructor']?.kind).toBe('constructor')
    expect(by['Store.save']?.kind).toBe('method')
    expect(by.plain?.kind).toBeUndefined()
    expect(by['Store.size']?.kind).toBe('getter')
    expect(by['Store.label']?.kind).toBe('setter')
  })

  it('does not count markup drawn by a named inner function against its parent', async () => {
    const by = await scanned('a.tsx', 'function outer() {\n  function Inner() { return <i /> }\n  return 1\n}\n')
    expect(by.outer?.kind).toBeUndefined()
    expect(by.Inner?.kind).toBe('component')
  })

  it('records a rendered component as a call, but never a plain tag', async () => {
    const by = await scanned(
      'a.tsx',
      'function Card() { return <div /> }\nfunction div() { return 1 }\nfunction Page() { return <main><Card /><div /></main> }\n',
    )
    expect(by.Page?.calls).toEqual([{ file: 'a.tsx', fn: 0 }])
  })
})
