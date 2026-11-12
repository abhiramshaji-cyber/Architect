import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scan } from '../scan/scan'
import { entryFiles, functionsOf } from './index'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function listOf(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-library-'))
  roots.push(root)
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  const map = await scan(root)
  const list = functionsOf(map, entryFiles(root, map))
  const under = (at: number): number[] => [at, ...(list.tree.children[at] ?? []).flatMap(under)]
  const names = (roots: number[]) => roots.flatMap(under).map((at) => list.rows[at]?.name).sort()
  return { list, unreached: names(list.tree.unreached), unknown: names(list.tree.unknown) }
}

const LIBRARY = {
  'package.json': JSON.stringify({
    name: 'lib',
    module: './dist/esm/index.js',
    exports: {
      '.': { types: './dist/index.d.ts', import: './dist/esm/index.js', require: './dist/cjs/index.cjs' },
      './plugins/*': { default: './dist/esm/plugins/*.js' },
      './package.json': './package.json',
    },
  }),
  'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'dist/esm', rootDir: 'src' } }),
  'src/index.ts': "import { normalize } from './text'\nexport { parse } from './parse'\nexport function format(s: string) { return normalize(s) }\n",
  'src/parse.ts': 'export function parse(s: string) { return tokens(s) }\nfunction tokens(s: string) { return s.split(" ") }\n',
  'src/text.ts': 'export function normalize(s: string) { return s.trim() }\nexport function orphan() { return leftover() }\nfunction leftover() { return 1 }\n',
  'src/plugins/upper.ts': 'export default function upper(s: string) { return s.toUpperCase() }\n',
  'src/plugins/lower.ts': 'export function lower(s: string) { return s.toLowerCase() }\n',
}

describe('a library published through package.json exports', () => {
  it('starts at every exported entry and flags only code nothing reaches', async () => {
    const { list, unreached, unknown } = await listOf(LIBRARY)
    const reasons = Object.fromEntries(list.tree.groups.map((group) => [group.file, group.reason]))
    expect(reasons).toEqual({ 'src/index.ts': 'exports', 'src/plugins/lower.ts': 'exports', 'src/plugins/upper.ts': 'exports' })
    expect(unreached).toEqual(['leftover', 'orphan'])
    expect(unknown).toEqual([])
  })

  it('maps through any tsconfig in the package and keeps an unmapped entry out of unreached', async () => {
    const source = { 'src/index.ts': 'export function api() { return inner() }\nfunction inner() { return 1 }\n' }
    const built = await listOf({
      ...source,
      'package.json': JSON.stringify({ exports: './dist/index.js' }),
      'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.build.json' }] }),
      'tsconfig.build.json': JSON.stringify({ compilerOptions: { outDir: 'dist', rootDir: 'src' }, include: ['src'] }),
    })
    expect(built.list.tree.groups).toEqual([{ file: 'src/index.ts', reason: 'exports', members: [0] }])
    const rolled = await listOf({ ...source, 'package.json': JSON.stringify({ exports: { '.': './dist/bundle.js' } }) })
    expect(rolled.unreached).toEqual([])
    expect(rolled.unknown).toEqual(['api', 'inner'])
    expect(rolled.list.rows.find((row) => row.name === 'api')?.untraced).toBe('export')
  })

  it('keeps a package with an unmapped entry from hiding dead code in the packages inside it', async () => {
    const { unreached, unknown } = await listOf({
      'package.json': JSON.stringify({ exports: { './worker': './build/worker.js' } }),
      'src/root.ts': 'export function rootApi() {}\n',
      'packages/b/package.json': JSON.stringify({ exports: './src/index.ts' }),
      'packages/b/src/index.ts': 'export function live() {}\n',
      'packages/b/src/dead.ts': 'export function deadExport() {}\n',
    })
    expect(unreached).toEqual(['deadExport'])
    expect(unknown).toEqual(['rootApi'])
  })

  it('puts test code and bodiless declarations in reach unknown, never what only tests call', async () => {
    const { unreached, unknown } = await listOf({
      'package.json': JSON.stringify({ exports: './src/index.ts' }),
      'src/index.ts': 'export function api() {}\n',
      'src/shim.ts': 'declare global { function later(): void }\nexport function onlyTested() {}\n',
      'src/index.test.ts': "import { onlyTested } from './shim'\nfunction setup() { onlyTested() }\nit('x', () => setup())\n",
    })
    expect(unreached).toEqual(['onlyTested'])
    expect(unknown).toEqual(['later', 'setup'])
  })

  it('counts the members of an anonymous default class as library API', async () => {
    const { unreached, list } = await listOf({
      'package.json': JSON.stringify({ exports: { '.': './src/index.ts' } }),
      'src/index.ts': "export { default as Store } from './store'\n",
      'src/store.ts': 'export default class {\n  start() { return this.go() }\n  go() {}\n}\n',
    })
    expect(unreached).toEqual([])
    expect(list.rows.map((row) => row.name).sort()).toEqual(['default.go', 'default.start'])
  })

  it('reads the module field on its own and a workspace package in a subfolder', async () => {
    const { list } = await listOf({
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/core/package.json': JSON.stringify({ module: './src/index.ts' }),
      'packages/core/src/index.ts': 'export function core() { return 1 }\n',
    })
    expect(list.tree.groups).toEqual([{ file: 'packages/core/src/index.ts', reason: 'module', members: [0] }])
    expect(list.tree.unreached).toEqual([])
  })
})
