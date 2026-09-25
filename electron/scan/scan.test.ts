import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scan } from './scan'
import type { CallRef, CodeMap, FolderEntry, FunctionEntry } from '../../shared/types'

const roots: string[] = []

function fixture(files: Record<string, string>, dirs: string[] = []): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-scan-'))
  roots.push(root)

  for (const dir of dirs) fs.mkdirSync(path.join(root, dir), { recursive: true })

  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }

  return root
}

function folder(map: CodeMap, at: string): FolderEntry {
  const found = map.folders.find((f) => f.path === at)
  if (!found) throw new Error(`missing folder: ${at}`)
  return found
}

function entries(map: CodeMap, file: string): FunctionEntry[] {
  const at = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''
  const entry = folder(map, at).files.find((f) => f.path === file)
  if (!entry) throw new Error(`missing file: ${file}`)
  return entry.functions
}

function refs(map: CodeMap, file: string, name: string): CallRef[] {
  const fn = entries(map, file).find((f) => f.name === name)
  if (!fn) throw new Error(`missing function: ${name}`)
  return fn.calls
}

function calls(map: CodeMap, file: string, name: string): number[] {
  return refs(map, file, name)
    .flatMap((call) => (call.file === file ? [call.fn] : []))
    .sort((a, b) => a - b)
}

function targets(map: CodeMap, file: string, name: string): string[] {
  return refs(map, file, name)
    .map((call) => `${call.file}:${entries(map, call.file)[call.fn]?.name}`)
    .sort()
}

function names(map: CodeMap, file: string): string[] {
  const at = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''
  const entry = folder(map, at).files.find((f) => f.path === file)
  if (!entry) throw new Error(`missing file: ${file}`)
  return entry.functions.map((f) => f.name)
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('scan', () => {
  it('returns the root folder with an empty path', async () => {
    const map = await scan(fixture({ 'a.ts': 'export const x = 1\n' }))

    expect(map.folders.map((f) => f.path)).toEqual([''])
    expect(folder(map, '').files.map((f) => f.path)).toEqual(['a.ts'])
  })

  it('flattens every folder for O(1) lookup', async () => {
    const map = await scan(fixture({ 'src/deep/nested/a.ts': '', 'src/b.ts': '' }))

    expect(map.folders.map((f) => f.path)).toEqual(['', 'src', 'src/deep', 'src/deep/nested'])
    expect(folder(map, 'src').folders).toEqual(['src/deep'])
    expect(folder(map, 'src').files.map((f) => f.path)).toEqual(['src/b.ts'])
    expect(folder(map, 'src/deep/nested').files.map((f) => f.path)).toEqual(['src/deep/nested/a.ts'])
  })

  it('keeps empty folders and files without functions', async () => {
    const map = await scan(fixture({ 'notes.ts': 'export const n = 1\n' }, ['empty', 'empty/deeper']))

    expect(folder(map, 'empty').files).toEqual([])
    expect(folder(map, 'empty').folders).toEqual(['empty/deeper'])
    expect(folder(map, 'empty/deeper').folders).toEqual([])
    expect(names(map, 'notes.ts')).toEqual([])
  })

  it('skips ignored and dot directories', async () => {
    const map = await scan(
      fixture({
        'node_modules/pkg/i.ts': 'export function nope() {}',
        'dist/o.js': 'function nope() {}',
        'out/o.js': 'function nope() {}',
        'build/o.js': 'function nope() {}',
        '.git/hooks/h.js': 'function nope() {}',
        '.architect/a.ts': 'function nope() {}',
        '.claude/c.ts': 'function nope() {}',
        '.secret/s.ts': 'function nope() {}',
        'src/keep.ts': 'export function keep() {}',
      }),
    )

    expect(map.folders.map((f) => f.path)).toEqual(['', 'src'])
    expect(names(map, 'src/keep.ts')).toEqual(['keep'])
  })

  it('skips binary files', async () => {
    const root = fixture({ 'a.ts': 'export function a() {}' })
    fs.writeFileSync(path.join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))

    const map = await scan(root)

    expect(folder(map, '').files.map((f) => f.path)).toEqual(['a.ts'])
  })

  it('lists non-parsed text files with no functions', async () => {
    const map = await scan(fixture({ 'readme.md': '# hi\n\nfunction fake() {}\n', 'a.ts': '' }))

    expect(names(map, 'readme.md')).toEqual([])
  })

  it('finds function declarations including nested and default', async () => {
    const map = await scan(
      fixture({
        'a.ts': [
          'export function top() {',
          '  function inner() {}',
          '  return inner',
          '}',
          'function* gen() {}',
          'async function load() {}',
          'async function* streamed() {}',
        ].join('\n'),
        'b.ts': 'export default function () {}',
        'c.ts': 'export default function named() {}',
      }),
    )

    expect(names(map, 'a.ts')).toEqual(['top', 'inner', 'gen', 'load', 'streamed'])
    expect(names(map, 'b.ts')).toEqual(['default'])
    expect(names(map, 'c.ts')).toEqual(['named'])
  })

  it('finds functions bound to variables', async () => {
    const map = await scan(
      fixture({
        'a.ts': [
          'const arrow = () => {}',
          'let expr = function () {}',
          'var named = function inner() {}',
          'const asyncArrow = async () => {}',
          'const genExpr = function* () {}',
          'const notAFunction = 4',
        ].join('\n'),
      }),
    )

    expect(names(map, 'a.ts')).toEqual(['arrow', 'expr', 'named', 'asyncArrow', 'genExpr'])
  })

  it('names class members after their class', async () => {
    const map = await scan(
      fixture({
        'a.ts': [
          'export class Store {',
          '  constructor() {}',
          '  save() {}',
          '  async load() {}',
          '  *walk() {}',
          '  get size() { return 0 }',
          '  set size(v: number) {}',
          '  bound = () => {}',
          '  static make() {}',
          '  #hidden() {}',
          '}',
          'const Anon = class {',
          '  run() {}',
          '}',
        ].join('\n'),
      }),
    )

    expect(names(map, 'a.ts')).toEqual([
      'Store.constructor',
      'Store.save',
      'Store.load',
      'Store.walk',
      'Store.size',
      'Store.size',
      'Store.bound',
      'Store.make',
      'Store.#hidden',
      'Anon.run',
    ])
  })

  it('names object literal methods and function properties', async () => {
    const map = await scan(
      fixture({
        'a.ts': [
          'export const api = {',
          '  get() {},',
          '  async post() {},',
          '  del: () => {},',
          "  'quoted': function () {},",
          '  [Symbol.iterator]: function () {},',
          '  plain: 3,',
          '}',
        ].join('\n'),
      }),
    )

    expect(names(map, 'a.ts')).toEqual(['api.get', 'api.post', 'api.del', 'api.quoted'])
  })

  it('reports 1-indexed declaration lines', async () => {
    const map = await scan(fixture({ 'a.ts': '\n\nexport function third() {}\n\nconst fifth = () => {}\n' }))

    const entry = folder(map, '').files[0]
    expect(entry?.functions).toEqual([
      { name: 'third', line: 3, endLine: 3, description: '', calls: [] },
      { name: 'fifth', line: 5, endLine: 5, description: '', calls: [] },
    ])
  })

  it('parses every supported extension', async () => {
    const map = await scan(
      fixture({
        'a.tsx': 'export const View = () => <div />',
        'b.jsx': 'export function View() { return <div /> }',
        'c.mjs': 'export function m() {}',
        'd.cjs': 'function c() {}',
        'e.js': 'const j = function () {}',
      }),
    )

    expect(names(map, 'a.tsx')).toEqual(['View'])
    expect(names(map, 'b.jsx')).toEqual(['View'])
    expect(names(map, 'c.mjs')).toEqual(['m'])
    expect(names(map, 'd.cjs')).toEqual(['c'])
    expect(names(map, 'e.js')).toEqual(['j'])
  })

  it('does not throw on broken files', async () => {
    const map = await scan(
      fixture({
        'broken.ts': 'export function ((( {{{ unterminated',
        'ok.ts': 'export function ok() {}',
      }),
    )

    expect(folder(map, '').files.map((f) => f.path)).toEqual(['broken.ts', 'ok.ts'])
    expect(names(map, 'ok.ts')).toEqual(['ok'])
  })

  it('handles an empty file', async () => {
    const map = await scan(fixture({ 'empty.ts': '' }))

    expect(names(map, 'empty.ts')).toEqual([])
  })

  it('lists no functions for ambient declaration files', async () => {
    const map = await scan(fixture({ 'types.d.ts': 'export declare function ambient(): void\n' }))

    expect(names(map, 'types.d.ts')).toEqual([])
  })

  it('skips build and asset directories', async () => {
    const map = await scan(
      fixture({
        'a.ts': 'export function a() {}',
        'coverage/c.ts': 'export function c() {}',
        'public/p.ts': 'export function p() {}',
        'vendor/v.ts': 'export function v() {}',
        '.next/n.ts': 'export function n() {}',
      }),
    )

    expect(map.folders.map((f) => f.path)).toEqual([''])
    expect(folder(map, '').files.map((f) => f.path)).toEqual(['a.ts'])
  })

  it('yields to the event loop while walking', async () => {
    const files: Record<string, string> = {}
    for (let n = 0; n < 120; n++) files[`f${n}.ts`] = `export function f${n}() {}`

    let ticks = 0
    let ticking = true
    const tick = () => {
      if (!ticking) return
      ticks += 1
      setImmediate(tick)
    }
    setImmediate(tick)

    const map = await scan(fixture(files))
    ticking = false

    expect(folder(map, '').files).toHaveLength(120)
    expect(ticks).toBeGreaterThan(0)
  })

  it('is deterministic across repeated scans', async () => {
    const root = fixture({
      'src/b.ts': 'export function b() {}\nexport const a = () => {}',
      'src/a.ts': 'export class C { m() {} }',
      'src/zz/z.ts': 'function z() {}',
      'readme.md': '# hi',
    })

    const first = await scan(root)
    const second = await scan(root)

    expect(first.folders).toEqual(second.folders)
    expect(first.root).toBe(root)
  })
})

describe('function spans', () => {
  it('ends a one line function on the line it starts', async () => {
    const map = await scan(fixture({ 'a.ts': 'export function a() { return 1 }\n' }))

    expect(entries(map, 'a.ts')).toEqual([
      { name: 'a', line: 1, endLine: 1, description: '', calls: [] },
    ])
  })

  it('covers the whole declaration of a multi line function', async () => {
    const map = await scan(fixture({ 'a.ts': 'const before = 1\n\nexport function a() {\n  return (\n    2\n  )\n}\n' }))

    expect(entries(map, 'a.ts').map((f) => [f.name, f.line, f.endLine])).toEqual([['a', 3, 7]])
  })

  it('spans an arrow assigned to a const', async () => {
    const map = await scan(fixture({ 'a.ts': 'export const a = () => {\n  return 1\n}\n' }))

    expect(entries(map, 'a.ts').map((f) => [f.line, f.endLine])).toEqual([[1, 3]])
  })

  it('gives a nested function its own span inside the outer one', async () => {
    const map = await scan(fixture({ 'a.ts': 'function outer() {\n  function inner() {\n    return 1\n  }\n  return inner\n}\n' }))

    expect(entries(map, 'a.ts').map((f) => [f.name, f.line, f.endLine])).toEqual([
      ['outer', 1, 6],
      ['inner', 2, 4],
    ])
  })
})

describe('function calls', () => {
  it('records a bare identifier call', async () => {
    const map = await scan(fixture({ 'a.ts': 'function helper() {}\nfunction caller() {\n  helper()\n}\n' }))

    expect(calls(map, 'a.ts', 'caller')).toEqual([0])
    expect(calls(map, 'a.ts', 'helper')).toEqual([])
  })

  it('records a call to an arrow assigned to a const', async () => {
    const map = await scan(fixture({ 'a.ts': 'const helper = () => 1\nfunction caller() {\n  return helper()\n}\n' }))

    expect(calls(map, 'a.ts', 'caller')).toEqual([0])
  })

  it('records a method call on a named object literal', async () => {
    const map = await scan(
      fixture({ 'a.ts': 'const obj = {\n  method() {},\n}\nfunction caller() {\n  obj.method()\n}\n' }),
    )

    expect(names(map, 'a.ts')).toContain('obj.method')
    expect(calls(map, 'a.ts', 'caller')).toEqual([0])
  })

  it('records a call to a class method by class name and by this', async () => {
    const map = await scan(
      fixture({
        'a.ts': 'class C {\n  m() {}\n  n() {\n    this.m()\n  }\n}\nfunction caller() {\n  C.m()\n}\n',
      }),
    )

    expect(calls(map, 'a.ts', 'C.n')).toEqual([0])
    expect(calls(map, 'a.ts', 'caller')).toEqual([0])
  })

  it('records self recursion', async () => {
    const map = await scan(fixture({ 'a.ts': 'function loop(n: number) {\n  return n > 0 ? loop(n - 1) : 0\n}\n' }))

    expect(calls(map, 'a.ts', 'loop')).toEqual([0])
  })

  it('ignores a call to a function imported from another file', async () => {
    const map = await scan(
      fixture({
        'a.ts': "import { helper } from './b'\nexport function caller() {\n  helper()\n}\n",
        'b.ts': 'export function helper() {}\n',
      }),
    )

    expect(calls(map, 'a.ts', 'caller')).toEqual([])
  })

  it('ignores a callee that matches no function in the file', async () => {
    const map = await scan(fixture({ 'a.ts': 'function caller() {\n  missing()\n  console.log(1)\n  obj.gone()\n}\n' }))

    expect(calls(map, 'a.ts', 'caller')).toEqual([])
  })

  it('deduplicates repeated calls', async () => {
    const map = await scan(fixture({ 'a.ts': 'function helper() {}\nfunction caller() {\n  helper()\n  helper()\n}\n' }))

    expect(calls(map, 'a.ts', 'caller')).toEqual([0])
  })

  it('keeps a nested function’s calls out of the enclosing function', async () => {
    const map = await scan(
      fixture({
        'a.ts': 'function deep() {}\nfunction outer() {\n  const inner = () => deep()\n  return inner\n}\n',
      }),
    )

    expect(calls(map, 'a.ts', 'outer')).toEqual([])
    expect(calls(map, 'a.ts', 'inner')).toEqual([0])
  })

  it('points a call at the implementation, not an earlier overload signature', async () => {
    const map = await scan(
      fixture({
        'a.ts':
          'function parse(x: string): number\nfunction parse(x: number): number\nfunction parse(x: unknown): number {\n  return 1\n}\nfunction main() {\n  parse(1)\n}\n',
      }),
    )

    expect(entries(map, 'a.ts').map((f) => [f.name, f.line])).toEqual([
      ['parse', 1],
      ['parse', 2],
      ['parse', 3],
      ['main', 6],
    ])
    expect(calls(map, 'a.ts', 'main')).toEqual([2])
  })

  it('resolves a shadowed local to the binding in its own scope', async () => {
    const map = await scan(
      fixture({
        'a.ts':
          'function outer() {\n  const visit = () => 1\n  return visit()\n}\nfunction other() {\n  const visit = () => 2\n  return visit()\n}\n',
      }),
    )

    expect(entries(map, 'a.ts').map((f) => [f.name, f.line])).toEqual([
      ['outer', 1],
      ['visit', 2],
      ['other', 5],
      ['visit', 6],
    ])
    expect(calls(map, 'a.ts', 'outer')).toEqual([1])
    expect(entries(map, 'a.ts')[2]?.calls).toEqual([{ file: 'a.ts', fn: 3 }])
  })

  it('never resolves an imported name to a local function of the same name', async () => {
    const map = await scan(
      fixture({
        'a.ts':
          "import { helper } from './b'\nfunction caller() {\n  helper()\n}\nfunction wrap() {\n  const helper = () => 2\n  return helper\n}\n",
        'b.ts': 'export function helper() {}\n',
      }),
    )

    expect(names(map, 'a.ts')).toContain('helper')
    expect(calls(map, 'a.ts', 'caller')).toEqual([])
  })

  it('never resolves a call to a name a parameter or a plain local shadows', async () => {
    const map = await scan(
      fixture({
        'a.ts':
          'function helper() {}\nfunction caller(helper: () => void) {\n  helper()\n}\nfunction local() {\n  const helper = require("x")\n  helper()\n}\n',
      }),
    )

    expect(names(map, 'a.ts')).toEqual(['helper', 'caller', 'local'])
    expect(calls(map, 'a.ts', 'caller')).toEqual([])
    expect(calls(map, 'a.ts', 'local')).toEqual([])
  })

  it('records calls made inside an anonymous callback', async () => {
    const map = await scan(
      fixture({ 'a.ts': 'function helper(n: number) {\n  return n\n}\nfunction caller(ns: number[]) {\n  return ns.map((n) => helper(n))\n}\n' }),
    )

    expect(calls(map, 'a.ts', 'caller')).toEqual([0])
  })
})

describe('cross file calls', () => {
  it('resolves a named import through an extensionless specifier', async () => {
    const map = await scan(
      fixture({
        'a.ts': "import { helper } from './b'\nexport function caller() {\n  helper()\n}\n",
        'b.ts': 'export function helper() {}\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual(['b.ts:helper'])
  })

  it('resolves an aliased named import, a default import and a namespace import', async () => {
    const map = await scan(
      fixture({
        'a.ts':
          "import wrapped, { helper as aid } from './b'\nimport * as ns from './b'\n" +
          'export function caller() {\n  aid()\n  wrapped()\n  ns.other()\n}\n',
        'b.ts': 'export function helper() {}\nexport function other() {}\nexport default function main() {}\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual(['b.ts:helper', 'b.ts:main', 'b.ts:other'])
  })

  it('resolves a method reached through a namespace import', async () => {
    const map = await scan(
      fixture({
        'a.ts': "import * as ns from './b'\nexport function caller() {\n  ns.Store.load()\n}\n",
        'b.ts': 'export class Store {\n  static load() {}\n}\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual(['b.ts:Store.load'])
  })

  it('resolves a directory specifier to its index file and a tsx sibling', async () => {
    const map = await scan(
      fixture({
        'a.ts':
          "import { helper } from './lib'\nimport { view } from './view'\n" +
          'export function caller() {\n  helper()\n  view()\n}\n',
        'lib/index.ts': 'export function helper() {}\n',
        'view.tsx': 'export function view() {}\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual(['lib/index.ts:helper', 'view.tsx:view'])
  })

  it('resolves a .js specifier to the .ts file it means', async () => {
    const map = await scan(
      fixture({
        'a.ts': "import { helper } from './b.js'\nexport function caller() {\n  helper()\n}\n",
        'b.ts': 'export function helper() {}\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual(['b.ts:helper'])
  })

  it('follows a named re-export and a star re-export to the declaring file', async () => {
    const map = await scan(
      fixture({
        'a.ts':
          "import { helper, other } from './barrel'\nexport function caller() {\n  helper()\n  other()\n}\n",
        'barrel.ts': "export { helper } from './b'\nexport * from './c'\n",
        'b.ts': 'export function helper() {}\n',
        'c.ts': 'export function other() {}\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual(['b.ts:helper', 'c.ts:other'])
  })

  it('renames across a re-export alias', async () => {
    const map = await scan(
      fixture({
        'a.ts': "import { aid } from './barrel'\nexport function caller() {\n  aid()\n}\n",
        'barrel.ts': "export { helper as aid } from './b'\n",
        'b.ts': 'export function helper() {}\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual(['b.ts:helper'])
  })

  it('records both directions of a circular import without hanging', async () => {
    const map = await scan(
      fixture({
        'a.ts': "import { down } from './b'\nexport function up() {\n  down()\n}\n",
        'b.ts': "import { up } from './a'\nexport function down() {\n  up()\n}\n",
      }),
    )

    expect(targets(map, 'a.ts', 'up')).toEqual(['b.ts:down'])
    expect(targets(map, 'b.ts', 'down')).toEqual(['a.ts:up'])
  })

  it('survives a barrel that re-exports itself', async () => {
    const map = await scan(
      fixture({
        'a.ts': "import { ghost } from './barrel'\nexport function caller() {\n  ghost()\n}\n",
        'barrel.ts': "export * from './barrel'\nexport * from './b'\n",
        'b.ts': 'export function helper() {}\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual([])
  })

  it('resolves nothing for a bare package, a node builtin or a missing file', async () => {
    const map = await scan(
      fixture({
        'a.ts':
          "import { readFileSync } from 'node:fs'\nimport ts from 'typescript'\nimport { gone } from './nowhere'\n" +
          'export function caller() {\n  readFileSync("x")\n  ts.createSourceFile()\n  gone()\n}\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual([])
  })

  it('resolves nothing for a specifier that points outside the scanned root', async () => {
    const root = fixture({
      'inner/a.ts': "import { helper } from '../outside'\nexport function caller() {\n  helper()\n}\n",
      'outside.ts': 'export function helper() {}\n',
    })
    const map = await scan(path.join(root, 'inner'))

    expect(targets(map, 'a.ts', 'caller')).toEqual([])
  })

  it('resolves nothing for a name the other file does not export', async () => {
    const map = await scan(
      fixture({
        'a.ts': "import { helper } from './b'\nexport function caller() {\n  helper()\n}\n",
        'b.ts': 'function helper() {}\nexport const value = 1\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual([])
  })

  it('resolves nothing for a type only import', async () => {
    const map = await scan(
      fixture({
        'a.ts': "import type { helper } from './b'\nexport function caller() {\n  helper()\n}\n",
        'b.ts': 'export function helper() {}\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual([])
  })

  it('lets a local binding shadow an import of the same name', async () => {
    const map = await scan(
      fixture({
        'a.ts':
          "import { helper } from './b'\nexport function caller() {\n  const helper = () => 1\n  return helper()\n}\nexport function other(helper: () => void) {\n  helper()\n}\n",
        'b.ts': 'export function helper() {}\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual(['a.ts:helper'])
    expect(targets(map, 'a.ts', 'other')).toEqual([])
  })

  it('keeps an import edge and a same file edge side by side', async () => {
    const map = await scan(
      fixture({
        'a.ts':
          "import { helper } from './b'\nfunction near() {}\nexport function caller() {\n  near()\n  helper()\n}\n",
        'b.ts': 'export function helper() {}\n',
      }),
    )

    expect(calls(map, 'a.ts', 'caller')).toEqual([0])
    expect(targets(map, 'a.ts', 'caller')).toEqual(['a.ts:near', 'b.ts:helper'])
  })

  it('follows a barrel that imports then re-exports under a local export clause', async () => {
    const map = await scan(
      fixture({
        'a.ts': "import { helper } from './barrel'\nexport function caller() {\n  helper()\n}\n",
        'barrel.ts': "import { helper } from './b'\nexport { helper }\n",
        'b.ts': 'export function helper() {}\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual(['b.ts:helper'])
  })

  it('resolves a default export that names a local function', async () => {
    const map = await scan(
      fixture({
        'a.ts': "import run from './b'\nexport function caller() {\n  run()\n}\n",
        'b.ts': 'function helper() {}\nexport default helper\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual(['b.ts:helper'])
  })

  it('resolves through an export star as namespace', async () => {
    const map = await scan(
      fixture({
        'a.ts': "import { deep } from './barrel'\nexport function caller() {\n  deep.helper()\n}\n",
        'barrel.ts': "export * as deep from './b'\n",
        'b.ts': 'export function helper() {}\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual(['b.ts:helper'])
  })

  it('resolves an import equals require of a relative file', async () => {
    const map = await scan(
      fixture({
        'a.ts': "import b = require('./b')\nexport function caller() {\n  b.helper()\n}\n",
        'b.ts': 'export function helper() {}\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual(['b.ts:helper'])
  })

  it('resolves a tsconfig path alias', async () => {
    const map = await scan(
      fixture({
        'tsconfig.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["src/lib/*"] } } }',
        'a.ts': "import { helper } from '@lib/b'\nexport function caller() {\n  helper()\n}\n",
        'src/lib/b.ts': 'export function helper() {}\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual(['src/lib/b.ts:helper'])
  })

  it('resolves through a root reached by a symlink', async () => {
    const real = fixture({
      'a.ts': "import { helper } from './b'\nexport function caller() {\n  helper()\n}\n",
      'b.ts': 'export function helper() {}\n',
    })
    const alias = `${real}-link`
    fs.symlinkSync(real, alias)
    roots.push(alias)

    expect(targets(await scan(alias), 'a.ts', 'caller')).toEqual(['b.ts:helper'])
  })

  it('points at the exported arrow constant, not the first name in the file', async () => {
    const map = await scan(
      fixture({
        'a.ts': "import { later } from './b'\nexport function caller() {\n  later()\n}\n",
        'b.ts': 'export const early = () => 1\nexport const later = () => 2\n',
      }),
    )

    expect(targets(map, 'a.ts', 'caller')).toEqual(['b.ts:later'])
  })
})
