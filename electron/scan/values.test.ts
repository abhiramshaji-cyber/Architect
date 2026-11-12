import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scan } from './scan'
import type { CodeMap } from '../../shared/types'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function mapOf(files: Record<string, string>): Promise<CodeMap> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-values-'))
  roots.push(root)
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  return scan(root)
}

function valuesOf(map: CodeMap, file: string): string[] {
  const files = map.folders.flatMap((folder) => folder.files)
  const name = (target: string, fn: number) => files.find((f) => f.path === target)?.functions[fn]?.name
  const start = files.find((f) => f.path === file)?.starts?.find((s) => s.kind === 'value')
  return (start?.calls ?? []).map((call) => `${call.file}:${name(call.file, call.fn)}`).sort()
}

describe('value references', () => {
  it('records functions passed, stored or bound instead of called, and never a plain call or a type', async () => {
    const map = await mapOf({
      'a.ts': [
        'function passed(n: number) { return n }',
        'function stored() {}',
        'function bound() {}',
        'function called() {}',
        'function typed() {}',
        'const table = { go: stored }',
        'export function run(ns: number[]): typeof typed { called(); bound.call(null); return ns.map(passed) as never }',
        'export { called }',
      ].join('\n'),
    })
    expect(valuesOf(map, 'a.ts')).toEqual(['a.ts:bound', 'a.ts:passed', 'a.ts:stored'])
  })

  it('records every member of a class that is constructed, an object that escapes and an anonymous object', async () => {
    const map = await mapOf({
      'a.ts': [
        'class Box { open() {} shut() { this.open() } }',
        'const kept = { use() {} }',
        'const loose = { go() {} }',
        'export function make() { new Box(); register(loose); kept.use(); return { start: () => 1, stop() {} } }',
        'function register(x: unknown) { return x }',
      ].join('\n'),
    })
    expect(valuesOf(map, 'a.ts')).toEqual(['a.ts:Box.open', 'a.ts:Box.shut', 'a.ts:loose.go', 'a.ts:start', 'a.ts:stop'])
  })

  it('lets a property named like a function call that function, not itself', async () => {
    const map = await mapOf({ 'a.ts': 'function run() {}\nexport function make() { return { run: () => run() } }\n' })
    const run = map.folders[0]?.files[0]?.functions.find((f) => f.name === 'run' && f.line === 2)
    expect(run?.calls).toEqual([{ file: 'a.ts', fn: 0 }])
  })

  it('records the whole module behind a namespace used as a value or a dynamic import', async () => {
    const map = await mapOf({
      'lib.ts': 'export function one() {}\nexport const api = { two() {} }\nfunction hidden() {}\n',
      'more.ts': 'export function three() {}\n',
      'a.ts': "import * as lib from './lib'\nexport function go() { use(lib); return import('./more') }\nfunction use(x: unknown) { return x }\n",
    })
    expect(valuesOf(map, 'a.ts')).toEqual(['lib.ts:api.two', 'lib.ts:one', 'more.ts:three'])
  })

  it('records every module a glob or a dynamic import with a static folder can load', async () => {
    const map = await mapOf({
      'src/pages/home.tsx': 'export default function Home() { return null }\n',
      'src/locales/en.ts': 'export function greet() {}\n',
      'src/main.ts': "const pages = import.meta.glob('./pages/*.tsx')\nexport function load(n: string) { return import(`./locales/${n}.ts`) }\n",
    })
    expect(valuesOf(map, 'src/main.ts')).toEqual(['src/locales/en.ts:greet', 'src/pages/home.tsx:Home'])
  })

  it('records the members of a class rendered as a JSX tag and pages matched by a single character glob', async () => {
    const map = await mapOf({
      'src/pages/a.ts': 'export function page() {}\n',
      'src/main.tsx': "class Boundary { render() { return null } }\nconst pages = import.meta.glob('./pages/?.ts')\nexport function App() { return <Boundary /> }\n",
    })
    expect(valuesOf(map, 'src/main.tsx')).toEqual(['src/main.tsx:Boundary.render', 'src/pages/a.ts:page'])
  })

  it('records nothing for a test file', async () => {
    const map = await mapOf({ 'a.test.ts': 'function cb() {}\n[1].map(cb)\n' })
    expect(valuesOf(map, 'a.test.ts')).toEqual([])
  })
})
