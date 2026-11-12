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
  it('copies a doc block verbatim, tags, links and line breaks included', async () => {
    const by = await scanned(
      'a.ts',
      [
        '/**',
        ' * Loads the {@link Config} from `disk`. Falls back to defaults.',
        ' *',
        ' * @param root where to look',
        ' */',
        'export function load(root: string) {}',
        '/** one line, no full stop */',
        'function short() {}',
      ].join('\n'),
    )
    expect(by.load?.doc).toBe('Loads the {@link Config} from `disk`. Falls back to defaults.\n\n@param root where to look')
    expect(by.short?.doc).toBe('one line, no full stop')
  })

  it('keeps a long doc whole, whatever it starts with or shows', async () => {
    const words = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ')
    const by = await scanned(
      'a.ts',
      [
        `/** ${words}. Second sentence. */`,
        'function long() {}',
        '/** License key check for the user. */',
        'function a() {}',
        '/** Use as `run({ fast: true })`; returns early. */',
        'function run() {}',
      ].join('\n'),
    )
    expect([by.long?.doc, by.a?.doc, by.run?.doc]).toEqual([
      `${words}. Second sentence.`,
      'License key check for the user.',
      'Use as `run({ fast: true })`; returns early.',
    ])
  })

  it('finds a doc block above a const arrow and past a directive line', async () => {
    const by = await scanned('a.ts', '/** Totals it. */\nexport const total = () => 1\n/** Reads it. */\n// eslint-disable-next-line\nfunction read() {}\n')
    expect([by.total?.doc, by.read?.doc]).toEqual(['Totals it.', 'Reads it.'])
  })

  it('keeps indentation inside a block without stars', async () => {
    const by = await scanned('a.ts', 'class A {\n  /**\n    Runs:\n      step one\n  */\n  run() {}\n}\n')
    expect(by['A.run']?.doc).toBe('Runs:\n  step one')
  })

  it('never takes line or plain block comments, empty blocks or a block separated by a blank line', async () => {
    const by = await scanned(
      'a.ts',
      [
        '// return early',
        'function a() {}',
        '/* Copyright 2024 Acme */',
        'function b() {}',
        '// if (ready) {',
        '//   start()',
        'function c() {}',
        '/** Something unrelated here. */',
        '',
        'function d() {}',
        'function e() {}',
        '/** */',
        'function f() {}',
        '/**/',
        'function g() {}',
      ].join('\n'),
    )
    expect([by.a, by.b, by.c, by.d, by.e, by.f, by.g].map((fn) => fn?.doc)).toEqual(Array(7).fill(undefined))
  })
})

describe('signature', () => {
  it('records parameters and the return type exactly as written', async () => {
    const by = await scanned(
      'a.ts',
      [
        'export function pick<T extends object, K extends keyof T>(',
        '  item: T,',
        '  keys: K[],',
        '  label?: string,',
        "  mode = 'all',",
        '  ...rest: Array<',
        '    number',
        '  >',
        '): Pick<T, K> { return item }',
      ].join('\n'),
    )
    expect(by.pick?.signature).toEqual({
      generics: 'T extends object, K extends keyof T',
      params: [
        { name: 'item', type: 'T' },
        { name: 'keys', type: 'K[]' },
        { name: 'label', type: 'string', optional: true },
        { name: 'mode', value: "'all'" },
        { name: 'rest', type: 'Array< number >', rest: true },
      ],
      returns: 'Pick<T, K>',
    })
  })

  it('joins a type split over lines but keeps spaces inside it', async () => {
    const by = await scanned('a.ts', "function f(): Promise<\n  'a  b'\n> { return null! }\n")
    expect(by.f?.signature?.returns).toBe("Promise< 'a  b' >")
  })

  it('records each overload as its own entry with its own doc and signature', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-traits-'))
    roots.push(root)
    const lines = ['/** Reads a number. */', 'function read(a: number): number', 'function read(a: string): string', 'function read(a: any): any { return a }']
    fs.writeFileSync(path.join(root, 'a.ts'), lines.join('\n'))
    const map = await scan(root)
    const reads = map.folders.flatMap((folder) => folder.files).flatMap((file) => file.functions)
    expect(reads.map((fn) => [fn.line, fn.doc, fn.signature?.returns])).toEqual([
      [2, 'Reads a number.', 'number'],
      [3, undefined, 'string'],
      [4, undefined, 'any'],
    ])
  })

  it('never infers a type the source leaves out', async () => {
    const by = await scanned('a.js', 'export const add = (a, b) => a + b\nasync function none() {}\n')
    expect(by.add?.signature).toEqual({ params: [{ name: 'a' }, { name: 'b' }] })
    expect(by.none?.signature).toEqual({ params: [] })
  })

  it('reads every kind of declared function', async () => {
    const by = await scanned(
      'a.ts',
      [
        'class Store {',
        '  constructor(private db: Db) {}',
        '  get size(): number { return 1 }',
        '  set label(v: string) {}',
        '  save = async (row: Row): Promise<void> => {}',
        '  find(this: Store, { id }: { id: string }) {}',
        '}',
        'const api = { call: function (url: string): Response { return fetch(url) } }',
        'export default (x: number): number => x',
        'const typed: Handler = (event) => {}',
      ].join('\n'),
    )
    expect(by['Store.constructor']?.signature?.params).toEqual([{ name: 'db', type: 'Db' }])
    expect(by['Store.size']?.signature).toEqual({ params: [], returns: 'number' })
    expect(by['Store.label']?.signature?.params).toEqual([{ name: 'v', type: 'string' }])
    expect(by['Store.save']?.signature).toEqual({ params: [{ name: 'row', type: 'Row' }], returns: 'Promise<void>' })
    expect(by['Store.find']?.signature?.params).toEqual([
      { name: 'this', type: 'Store' },
      { name: '{ id }', type: '{ id: string }' },
    ])
    expect(by['api.call']?.signature).toEqual({ params: [{ name: 'url', type: 'string' }], returns: 'Response' })
    expect(by.default?.signature).toEqual({ params: [{ name: 'x', type: 'number' }], returns: 'number' })
    expect(by.typed?.signature).toEqual({ params: [{ name: 'event' }] })
  })
})

describe('rendered', () => {
  it('records a rendered component as a call, but never a plain tag', async () => {
    const by = await scanned(
      'a.tsx',
      'function Card() { return <div /> }\nfunction div() { return 1 }\nfunction Page() { return <main><Card /><div /></main> }\n',
    )
    expect(by.Page?.calls).toEqual([{ file: 'a.tsx', fn: 0 }])
  })
})
