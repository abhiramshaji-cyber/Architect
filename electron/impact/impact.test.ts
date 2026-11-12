import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Architecture, CodeMap } from '../../shared/types'
import { parse } from '../contract/graph'
import { scan } from '../scan/scan'
import { impactFor, impactOf, type ImpactInput } from '.'
import { callersOf } from './callers'
import { importsOf } from './tests'
import { changesOf } from './touched'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop() as string, { recursive: true, force: true })
})

const CONTRACT = ['# Demo', '', 'A demo.', '', '## Components', '', '### api', 'Http.', 'owns: `api/**`', '', '### store', 'Data.', 'owns: `store/**`', '', '### both', 'Overlap.', 'owns: `store/db.ts`', '', '## Dependencies', '', '- api -> store', ''].join('\n')

const FILES: Record<string, string> = {
  'store/db.ts': 'export function load() {\n  return 1\n}\n\nexport function save() {\n  return 2\n}\n\nexport function idle() {\n  return 3\n}\n',
  'store/cache.ts': "import { load } from './db'\n\nexport function cached() {\n  return load()\n}\n",
  'api/handler.ts': "import { cached } from '../store/cache'\n\nexport function handle() {\n  return cached()\n}\n",
  'api/route.ts': "import { handle } from './handler'\n\nexport function route() {\n  return handle()\n}\n",
  'lib/top.ts': "import { route } from '../api/route'\n\nexport function top() {\n  return route()\n}\n",
  'lib/loop.ts': "import { save } from '../store/db'\n\nexport function ping() {\n  save()\n  return pong()\n}\n\nexport function pong() {\n  return ping()\n}\n",
  'store/db.test.ts': "import { idle } from './db'\n\nit('idles', () => idle())\n",
  'api/handler.test.ts': "import { cached } from '../store/cache'\n\nfunction viaCache() {\n  return cached()\n}\n",
}

async function project(files = FILES): Promise<{ root: string; map: CodeMap; architecture: Architecture }> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'architect-impact-')))
  roots.push(root)
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  return { root, map: await scan(root), architecture: parse(CONTRACT) }
}

const edit = (root: string, file: string, from: string, to: string): ImpactInput => ({ cwd: root, file, content: fs.readFileSync(path.join(root, file), 'utf8').replace(from, to) })

describe('changesOf', () => {
  it('finds added, changed and removed functions by span and keeps same named ones apart', () => {
    const before = 'function a() {\n  return 1\n}\nfunction a() {\n  return 2\n}\nfunction gone() {}\n'
    const after = 'function a() {\n  return 1\n}\nfunction a() {\n  return 3\n}\nfunction fresh() {}\n'
    expect(changesOf('x.ts', before, after)).toMatchObject({
      changes: [
        { name: 'a', key: '/a#1', line: 4, change: 'changed', shares: [] },
        { name: 'gone', key: '/gone#0', line: 7, change: 'removed', shares: [] },
        { name: 'fresh', key: '/fresh#0', line: 7, change: 'added', shares: [] },
      ],
      parsed: 6,
      outside: { names: [], locals: [] },
    })
  })

  it('keeps inner functions with their outer one when a function is inserted above', () => {
    const before = 'function a() {\n  const f = () => 0\n  return f()\n}\nfunction b() {\n  const f = () => 1\n  return f()\n}\n'
    const after = `function z() {\n  const f = () => 2\n  return f()\n}\n${before}`
    expect(changesOf('x.ts', before, after).changes).toEqual([
      { name: 'z', key: '/z#0', line: 1, change: 'added', shares: [] },
      { name: 'f', key: '/z#0/f#0', line: 2, change: 'added', shares: [] },
    ])
  })

  it('keeps siblings on one line apart and says an edit there counts for each', async () => {
    const before = 'const o = { a() { return 1 }, b() { return 2 } }\n'
    const after = 'const o = { a() { return 1 }, b() { return 3 } }\n'
    const { changes } = changesOf('x.ts', before, after)
    expect(changes.map((change) => `${change.key} ${change.change} ${change.shares.join(',')}`)).toEqual(['/o.a#0 changed o.b', '/o.b#0 changed o.a'])
    const split = changesOf('x.ts', 'const a = () => 1; const b = () => 2\n', 'const a = () => 1\nconst b = () => 2\n').changes
    expect(split.map((change) => `${change.key} ${change.change}`)).toEqual(['/a#0 changed', '/b#0 changed'])
  })

  it('marks only the inner function when only its body changes', () => {
    const before = 'function outer() {\n  const x = 1\n  function inner() {\n    return 1\n  }\n  return inner() + x\n}\n'
    expect(changesOf('x.ts', before, before.replace('return 1', 'return 2')).changes.map((change) => `${change.key} ${change.change}`)).toEqual(['/outer#0/inner#0 changed'])
    expect(changesOf('x.ts', before, before.replace('const x = 1', 'const x = 2')).changes.map((change) => `${change.key} ${change.change}`)).toEqual(['/outer#0 changed'])
  })

  it('touches nothing when only code outside every function changes', () => {
    expect(changesOf('x.ts', 'const a = 1\nfunction f() {}\n', 'const a = 2\nfunction f() {}\n').changes).toEqual([])
  })
})

describe('callersOf', () => {
  it('walks callers once each through a cycle, nearest depth first, and counts entries that call in', () => {
    const fns = ['a', 'b', 'c', 'd'].map((name, line) => ({ file: 'x.ts', name, line: line + 1, test: false }))
    const files = [{ path: 'x.ts', functions: [], starts: [{ kind: 'load' as const, calls: [{ file: 'x.ts', fn: 3 }] }, { kind: 'exports' as const, calls: [{ file: 'x.ts', fn: 0 }] }] }]
    const { reach, callers, entries } = callersOf(fns, files, [[1], [2], [0], [2]], [0])
    expect([...reach.depth]).toEqual([[0, 0], [2, 1], [1, 2], [3, 2], [4, 3]])
    expect(callers.listed.map((caller) => `${caller.depth} ${caller.name} -> ${caller.calls}`)).toEqual(['1 c -> x.ts:1 a', '2 b -> x.ts:3 c', '2 d -> x.ts:3 c'])
    expect(entries).toEqual({ total: 1, listed: [{ kind: 'load', file: 'x.ts', depth: 3, calls: 'x.ts:4 d' }] })
  })
})

describe('impactOf', () => {
  it('counts transitive callers per depth with evidence, stopping the list at depth three', async () => {
    const { root, map, architecture } = await project()
    const impact = impactOf(edit(root, 'store/db.ts', 'return 1', 'return 9'), root, architecture, map)

    expect(impact.touched).toEqual({ total: 1, listed: [{ name: 'load', change: 'changed', at: 'store/db.ts:1', in: 'disk' }] })
    expect(impact.callers.depths).toEqual([
      { depth: 1, count: 1, first: 'store/cache.ts:3 cached' },
      { depth: 2, count: 1, first: 'api/handler.ts:3 handle' },
      { depth: 3, count: 1, first: 'api/route.ts:3 route' },
      { depth: 4, count: 1, first: 'lib/top.ts:3 top' },
    ])
    expect(impact.callers.listed.map((caller) => `${caller.depth} ${caller.at} -> ${caller.calls}`)).toEqual([
      '1 store/cache.ts:3 -> store/db.ts:1 load',
      '2 api/handler.ts:3 -> store/cache.ts:3 cached',
      '3 api/route.ts:3 -> api/handler.ts:3 handle',
    ])
    expect(impact.callers).toMatchObject({ total: 4, listedThrough: 3, unlisted: 1 })
    expect(impact.notes).toEqual(['1 of 4 callers are counted in depths but not listed; the list stops at depth 3 or 25 callers'])
    expect(impact.components).toEqual([
      { id: 'api', functions: 2, entries: 0, first: 'api/handler.ts:3' },
      { id: 'store', functions: 2, entries: 0, first: 'store/cache.ts:3' },
      { id: 'both', functions: 1, entries: 0, first: 'store/db.ts:1' },
      { id: null, functions: 1, entries: 0, first: 'lib/top.ts:3' },
    ])
  })

  it('finds the tests that call or import what is reached, with the line', async () => {
    const { root, map, architecture } = await project()
    const impact = impactOf(edit(root, 'store/db.ts', 'return 1', 'return 9'), root, architecture, map)

    expect(impact.tests).toEqual({ total: 1, listed: [{ file: 'api/handler.test.ts', via: 'call', at: 'api/handler.test.ts:3', reaches: 'store/cache.ts:3' }] })

    const idle = impactOf(edit(root, 'store/db.ts', 'return 3', 'return 7'), root, architecture, map)
    expect(idle.tests.listed).toEqual([{ file: 'store/db.test.ts', via: 'import', at: 'store/db.test.ts:1', reaches: 'store/db.ts:9' }])
    expect(idle.notes).toContain('a test listed via import imports a reached function by name, or a whole file holding one; the scan does not see calls inside test callbacks, so it may not call it')
    expect(impact.callers.listed.some((caller) => caller.at.includes('.test.'))).toBe(false)
  })

  it('counts code outside any function that calls in as an entry, with its component', async () => {
    const { root, map, architecture } = await project({ ...FILES, 'api/start.ts': "import { top } from '../lib/top'\n\ntop()\n" })
    const impact = impactOf(edit(root, 'store/db.ts', 'return 1', 'return 9'), root, architecture, map)
    expect(impact.entries).toEqual({ total: 1, listed: [{ kind: 'load', file: 'api/start.ts', depth: 5, calls: 'lib/top.ts:3 top' }] })
    expect(impact.components[0]).toEqual({ id: 'api', functions: 2, entries: 1, first: 'api/handler.ts:3' })
    expect(impact.notes).toContain('an entry is code outside any function that calls in (a file loaded at start, an MCP tool, an IPC handler, a CLI command); the scan gives its file, not a line')
  })

  it('ends on a call cycle and reports a new function with no callers', async () => {
    const { root, map, architecture } = await project()
    const looped = impactOf(edit(root, 'store/db.ts', 'return 2', 'return 8'), root, architecture, map)
    expect(looped.callers.depths).toEqual([{ depth: 1, count: 1, first: 'lib/loop.ts:3 ping' }, { depth: 2, count: 1, first: 'lib/loop.ts:8 pong' }])

    const added = impactOf(edit(root, 'api/route.ts', 'export function route', 'export function extra() {}\n\nexport function route'), root, architecture, map)
    expect(added.touched.listed).toEqual([{ name: 'extra', change: 'added', at: 'api/route.ts:3', in: 'proposed' }])
    expect(added.callers.total).toBe(0)
    expect(added.components).toEqual([{ id: 'api', functions: 1, entries: 0, first: 'api/route.ts:3' }])
    expect(added.tests).toEqual({ total: 0, listed: [] })

    const tested = impactOf(edit(root, 'store/db.ts', 'export function load', 'export function extra() {}\n\nexport function load'), root, architecture, map)
    expect(tested.tests.total).toBe(0)
    const whole = await project({ ...FILES, 'store/db.test.ts': "import * as db from './db'\n\nit('idles', () => db.idle())\n" })
    const spread = impactOf(edit(whole.root, 'store/db.ts', 'export function load', 'export function extra() {}\n\nexport function load'), whole.root, whole.architecture, whole.map)
    expect(spread.tests.listed).toContainEqual({ file: 'store/db.test.ts', via: 'import', at: 'store/db.test.ts:1', reaches: 'store/db.ts:1' })
    expect(impactOf({ cwd: root, file: 'store/db.ts', content: fs.readFileSync(path.join(root, 'store/db.ts'), 'utf8') }, root, architecture, map).tests.total).toBe(0)
  })

  it('says why nothing is touched', async () => {
    const { root, map, architecture } = await project({ ...FILES, 'notes.md': '# notes\n' })
    fs.mkdirSync(path.join(root, 'dir.ts'))
    const notes = (input: ImpactInput) => impactOf(input, root, architecture, map).notes

    expect(notes({ cwd: root, file: '../out.ts', content: 'x' })).toEqual([`../out.ts is outside ${root}, so no function is touched`])
    expect(notes({ cwd: root, file: 'notes.md', content: '# more\n' })).toEqual(['notes.md holds no function the scan parses, so no function is touched'])
    expect(notes(edit(root, 'store/cache.ts', "'./db'", '"./db"'))).toEqual(['the change to store/cache.ts only touches formatting, quotes or comments, so nothing is counted'])
    expect(notes(edit(root, 'store/cache.ts', 'export function', '// note\nexport function'))).toEqual(['the change to store/cache.ts only touches formatting, quotes or comments, so nothing is counted'])
    expect(notes(edit(root, 'store/cache.ts', 'return load()', 'return load() // same'))).toEqual(['the change to store/cache.ts only touches formatting, quotes or comments, so nothing is counted'])
    expect(notes({ cwd: root, file: 'dir.ts', content: 'x' })).toEqual(['dir.ts could not be read (dir.ts is not a file), so no function is touched'])
    expect(notes({ cwd: path.join(root, 'api'), file: 'route.ts', content: fs.readFileSync(path.join(root, 'api/route.ts'), 'utf8') })).toEqual(['the proposed content of api/route.ts is the same as the file on disk, so no function is touched'])
  })

  it('notes a changed function the scan has not seen yet', async () => {
    const { root, architecture } = await project()
    const empty: CodeMap = { root, scannedAt: 0, folders: [] }
    expect(impactOf(edit(root, 'store/db.ts', 'return 1', 'return 9'), root, architecture, empty).notes).toEqual(['1 changed functions are not in the scan (load at store/db.ts:1); the scan skips this path or the file changed after the scan, so their callers are not counted'])
  })

  it('starts an edge from every function the calling component owns', async () => {
    const { root, map, architecture } = await project()
    const impact = impactOf({ cwd: root, from: 'api', to: 'store' }, root, architecture, map)
    expect(impact.touched.total).toBe(0)
    expect(impact.callers.depths).toEqual([{ depth: 1, count: 1, first: 'lib/top.ts:3 top' }])
    expect(impact.notes).toEqual(['an edge changes no function by itself; callers are those of the 2 functions api owns, the code that would come to depend on store'])
    expect(impactOf({ cwd: root, from: 'ghost', to: 'store' }, root, architecture, map).notes).toEqual(['ghost owns no scanned function, so nothing reaches the new dependency on store'])
  })
})

describe('impactFor', () => {
  it('scans once, reuses the scan while nothing changed, rescans after a change, and reports a failure', async () => {
    const { root, architecture } = await project()
    const input = edit(root, 'store/db.ts', 'return 1', 'return 9')
    const [first, second] = await Promise.all([impactFor(input, root, architecture), impactFor(input, root, architecture)])
    expect(first.callers.total).toBe(4)
    expect(second).toEqual(first)

    fs.writeFileSync(path.join(root, 'lib/more.ts'), "import { load } from '../store/db'\n\nexport function more() {\n  return load()\n}\n")
    expect((await impactFor(input, root, architecture)).callers.total).toBe(5)

    fs.mkdirSync(path.join(root, 'pad'))
    for (let i = 0; i < 200; i += 1) fs.writeFileSync(path.join(root, 'pad', `p${i}.ts`), `export function p${i}() {}\n`)
    expect(await impactFor(input, root, architecture, null, 0)).toMatchObject({ status: 'timeout' })
    expect((await impactFor(input, root, architecture, null, 0)).notes[0]).toMatch(/^impact was not worked out: scanning .* took longer than 0 ms/)

    expect((await impactFor(input, root, architecture, 'bad line')).notes[0]).toBe('architect.md does not parse (bad line); components come from the last version that parsed')

    const broken = await impactFor(input, root, {} as Architecture)
    expect(broken.notes[0]).toMatch(/^impact could not be worked out: /)
    expect(broken).toMatchObject({ status: 'failed', callers: { total: 0 } })
    expect(first.status).toBe('done')
  })
})

describe('tests reached through files that forward exports', () => {
  it('follows an index that re-exports, counts past the list and says which import has no line', async () => {
    const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`t/n${String(i).padStart(2, '0')}.test.ts`, "import { load } from '../store'\n"]))
    const { root, map, architecture } = await project({ ...FILES, 'store/index.ts': "export { load } from './db'\n", 'z/alias.test.ts': "import { load } from '@/store/db'\n", ...many })
    const withAlias = { ...map, folders: map.folders.map((folder) => ({ ...folder, files: folder.files.map((file) => (file.path === 'z/alias.test.ts' ? { ...file, imports: ['store/db.ts'] } : file)) })) }
    const impact = impactOf(edit(root, 'store/db.ts', 'return 1', 'return 9'), root, architecture, withAlias)

    expect(impact.tests.total).toBe(13)
    expect(impact.tests.listed).toHaveLength(10)
    expect(impact.tests.listed).toContainEqual({ file: 't/n00.test.ts', via: 'import', at: 't/n00.test.ts:1', reaches: 'store/db.ts:1' })
    expect(impact.notes).toContain('3 of 13 test files are counted but not listed')

    const alias = impactOf(edit(root, 'store/db.ts', 'return 1', 'return 9'), root, architecture, { ...withAlias, folders: withAlias.folders.filter((folder) => folder.path !== 't') })
    expect(alias.tests.listed).toContainEqual({ file: 'z/alias.test.ts', via: 'import', at: 'z/alias.test.ts', reaches: 'store/db.ts:1' })
    expect(alias.notes).toContain('z/alias.test.ts imports store/db.ts by a path that is not relative, so its import line and names are not checked')
  })

  it('says the edge is left to the verdict when a file is given too', async () => {
    const { root, map, architecture } = await project()
    const impact = impactOf({ ...edit(root, 'store/db.ts', 'return 1', 'return 9'), from: 'api', to: 'store' }, root, architecture, map)
    expect(impact.notes[0]).toBe('impact is worked out from store/db.ts; the edge api -> store is answered by the verdict only')
    expect(impact.touched.total).toBe(1)
  })
})

describe('importsOf', () => {
  it('reads each relative import with its line and the names it brings in, a type import bringing none', async () => {
    const { root } = await project({
      'a/b.ts': 'export const b = 1\n',
      'a/b.test.ts': "import type { T } from './t'\nimport { b, type U, c as d } from './b.js'\nimport * as all from './all'\nimport side from './side'\nexport * from './star'\nimport './bare'\nimport { x } from '@/alias'\n",
    })
    expect(importsOf(root, 'a/b.test.ts')).toEqual([
      { target: 'a/t', line: 1, names: [], forwards: false },
      { target: 'a/b', line: 2, names: ['b', 'c'], forwards: false },
      { target: 'a/all', line: 3, names: null, forwards: false },
      { target: 'a/side', line: 4, names: null, forwards: false },
      { target: 'a/star', line: 5, names: null, forwards: true },
      { target: 'a/bare', line: 6, names: [], forwards: false },
    ])
    expect(importsOf(root, 'a/none.test.ts')).toBe('unreadable')
  })
})

describe('line endings', () => {
  it('treats a file with CRLF line endings on disk as unchanged by the same text with LF', () => {
    expect(changesOf('x.ts', 'function f() {\r\n  return 1\r\n}\r\n', 'function f() {\n  return 1\n}\n').changes).toEqual([])
  })
})

describe('cases the reviews found', () => {
  it('checks every added function against the tests, counts callers of an overload, and lists an edited test file', async () => {
    const { root, map, architecture } = await project({
      ...FILES,
      'api/over.ts': 'export function o(x: string): string\nexport function o(x: number): number\nexport function o(x: unknown) {\n  return x\n}\n',
      'api/use.ts': "import { o } from './over'\n\nexport function use() {\n  return o(1)\n}\n",
      'api/new.test.ts': "import { second } from './route'\n",
    })
    const added = impactOf(edit(root, 'api/route.ts', 'export function route', 'export function first() {}\n\nexport function second() {}\n\nexport function route'), root, architecture, map)
    expect(added.tests.listed).toEqual([{ file: 'api/new.test.ts', via: 'import', at: 'api/new.test.ts:1', reaches: 'api/route.ts:5' }])

    const overload = impactOf(edit(root, 'api/over.ts', 'o(x: string): string', 'o(x: string): number'), root, architecture, map)
    expect(overload.callers.listed.map((caller) => caller.at)).toEqual(['api/use.ts:3'])

    const tested = impactOf(edit(root, 'api/handler.test.ts', 'return cached()', 'return cached() + 1'), root, architecture, map)
    expect(tested.tests.listed).toEqual([{ file: 'api/handler.test.ts', via: 'touched', at: 'api/handler.test.ts:4', reaches: 'api/handler.test.ts:4' }])
    expect(tested.components.map((component) => component.id)).toEqual(['api'])
  })

  it('keeps a function starting on the closing line of another apart from it', () => {
    const before = 'const a = () => {\n  return 1\n}; const b = () => 2\n'
    const { changes } = changesOf('x.ts', before, before.replace('=> 2', '=> 3'))
    expect(changes.map((change) => `${change.key} ${change.change} ${change.shares.join(',')}`)).toEqual(['/b#0 changed a'])
  })

})

describe('renamed re-exports and test callbacks', () => {
  it('finds a test importing a function re-exported under another name, and lists an edited test file with no named function', async () => {
    const { root, map, architecture } = await project({ ...FILES, 'store/index.ts': "export { load as start } from './db'\n", 'store/start.test.ts': "import { start } from './index'\n\nit('starts', () => start())\n" })
    const impact = impactOf(edit(root, 'store/db.ts', 'return 1', 'return 9'), root, architecture, map)
    expect(impact.tests.listed).toContainEqual({ file: 'store/start.test.ts', via: 'import', at: 'store/start.test.ts:1', reaches: 'store/db.ts:1' })

    const callback = impactOf(edit(root, 'store/start.test.ts', 'start())', 'start() + 1)'), root, architecture, map)
    expect(callback.tests.listed).toEqual([{ file: 'store/start.test.ts', via: 'touched', at: 'store/start.test.ts:3', reaches: 'store/start.test.ts:3' }])
  })

  it('counts callers of the file, and of the files importing a changed name, when code outside functions changes', async () => {
    const { root, map, architecture } = await project({
      ...FILES,
      'store/limit.ts': 'export const LIMIT = 5\nexport const OTHER = 1\nexport type Shape = { a: number }\n',
      'api/cap.ts': "import { LIMIT } from '../store/limit'\n\nexport function cap() {\n  return LIMIT\n}\n",
      'api/other.ts': "import { OTHER } from '../store/limit'\n\nexport function other() {\n  return OTHER\n}\n",
      'api/shape.ts': "import type { Shape } from '../store/limit'\n\nexport function shape(s: Shape) {\n  return s.a\n}\n",
      'api/cap.test.ts': "import { LIMIT } from '../store/limit'\n",
    })
    const constant = impactOf(edit(root, 'store/limit.ts', 'LIMIT = 5', 'LIMIT = 6'), root, architecture, map)
    expect(constant.callers.listed).toEqual([{ name: 'cap', at: 'api/cap.ts:3', depth: 1, calls: 'store/limit.ts top level code' }])
    expect(constant.tests.listed).toEqual([{ file: 'api/cap.test.ts', via: 'import', at: 'api/cap.test.ts:1', reaches: 'store/limit.ts' }])
    expect(constant.notes[0]).toBe('code outside every function in store/limit.ts changed (LIMIT), so its 0 functions that use those names count as touched, and the 1 functions in the 1 files that import those names, directly or through a re-export, count as its callers')

    const typed = impactOf(edit(root, 'store/limit.ts', 'a: number', 'a: string'), root, architecture, map)
    expect(typed.callers.listed.map((caller) => caller.name)).toEqual(['shape'])

    const imported = impactOf(edit(root, 'store/cache.ts', "import { load } from './db'", "import { load, save } from './db'"), root, architecture, map)
    expect(imported.notes).toEqual(['the change to store/cache.ts only touches formatting, quotes or comments, so nothing is counted'])
    const resourced = impactOf(edit(root, 'store/cache.ts', "import { load } from './db'", "import { load } from './other'"), root, architecture, map)
    expect(resourced.callers.listed.map((caller) => caller.name)).toEqual(['handle', 'route', 'top'])
    const side = impactOf(edit(root, 'store/cache.ts', "import { load } from './db'", "import './setup'\nimport { load } from './db'"), root, architecture, map)
    expect(side.notes[0]).toMatch(/^code outside every function in store\/cache.ts changed \(a module load or a star re-export\)/)
  })

  it('follows a local rename and a renamed re-export of it', async () => {
    const { root, map, architecture } = await project({
      ...FILES,
      'src/d.ts': 'function go() {\n  return 1\n}\nexport { go as start }\n',
      'src/e.ts': "export { start as begin } from './d'\n",
      'src/d.test.ts': "import { start } from './d'\n",
      'src/e.test.ts': "import { begin } from './e'\n",
    })
    const impact = impactOf(edit(root, 'src/d.ts', 'return 1', 'return 2'), root, architecture, map)
    expect(impact.tests.listed.map((test) => test.file)).toEqual(['src/d.test.ts', 'src/e.test.ts'])
  })

  it('follows a changed value through a barrel and a destructured export, and says nothing about importers of a new file', async () => {
    const { root, map, architecture } = await project({
      'src/a.ts': 'export const LIMIT = 3\nexport const { alpha, beta } = { alpha: 1, beta: 2 }\n',
      'src/index.ts': "export { LIMIT, alpha as first } from './a'\n",
      'src/e.ts': "import { LIMIT, first } from './index'\n\nexport function useLimit() {\n  return LIMIT\n}\n\nexport function useFirst() {\n  return first\n}\n",
      'src/d.ts': "import { alpha } from './a'\n\nexport function useAlpha() {\n  return alpha\n}\n",
    })
    const limit = impactOf(edit(root, 'src/a.ts', 'LIMIT = 3', 'LIMIT = 4'), root, architecture, map)
    expect(limit.callers.listed.map((caller) => caller.name)).toEqual(['useLimit', 'useFirst'])
    const alpha = impactOf(edit(root, 'src/a.ts', 'alpha: 1', 'alpha: 5'), root, architecture, map)
    expect(alpha.callers.listed.map((caller) => caller.name)).toEqual(['useAlpha', 'useLimit', 'useFirst'])
    const fresh = impactOf({ cwd: root, file: 'src/new.ts', content: 'export const X = 1\n' }, root, architecture, map)
    expect(fresh.notes).toEqual([])
  })

  it('counts an edit inside a top level callback, and credits an edit on a shared line to the function that holds that code', async () => {
    const { root, map, architecture } = await project({
      'src/main.ts': "import { work } from './work'\n\nregister('go', () => {\n  return work(1)\n})\n",
      'src/work.ts': 'export function work(n: number) {\n  return n\n}\n',
      'src/app.ts': "import './main'\n\nexport function boot() {\n  return 1\n}\n",
      'src/outer.ts': 'export function outer(a: number) {\n  const r = compute(a, { go: () => 1 })\n  return r\n}\n',
      'src/user.ts': "import { outer } from './outer'\n\nexport function user() {\n  return outer(1)\n}\n",
    })
    const callback = impactOf(edit(root, 'src/main.ts', 'work(1)', 'work(2)'), root, architecture, map)
    expect(callback.callers.listed.map((caller) => caller.name)).toEqual(['boot'])
    expect(callback.notes[0]).toMatch(/^code outside every function in src\/main.ts changed \(code that runs when the file loads, such as a handler it registers\)/)
    const shared = impactOf(edit(root, 'src/outer.ts', 'compute(', 'Math.max('), root, architecture, map)
    expect(shared.touched.listed.map((touch) => touch.name)).toEqual(['outer'])
    expect(shared.callers.listed.map((caller) => caller.name)).toEqual(['user'])
    expect(changesOf('x.ts', "function q() {\n  return 'a'\n}\n", 'function q() {\n  return "a"\n}\n').changes).toEqual([])
  })

  it('reads templates, regular expressions and JSX by their syntax, so an edit after them still counts', () => {
    const cases: [string, string, string, string][] = [
      ['x.ts', 'function f(dir: string) {\n  const pattern = `${dir}/*.ts`\n  const limit = 10\n  return [pattern, limit]\n}\n', 'limit = 10', 'limit = 99'],
      ['x.ts', 'function f(proto: string, host: string) {\n  return `${proto}://${host}/v1`\n}\n', '/v1', '/v2'],
      ['x.ts', 'function f(host: string) {\n  return `${host}//api/v1`\n}\n', 'v1', 'v2'],
      ['x.tsx', 'function F() {\n  return <p>see https://old.example.com</p>\n}\n', 'old', 'new'],
      ['x.ts', 'function f(s: string) {\n  const r = /a\\/*b/\n  return s.replace(r, "1")\n}\n', '"1"', '"2"'],
    ]
    for (const [file, before, from, to] of cases) expect(changesOf(file, before, before.replace(from, to)).changes.map((change) => change.name)).toEqual([file.endsWith('x') ? 'F' : 'f'])
  })

  it('follows a barrel that imports a value and exports it again', async () => {
    const { root, map, architecture } = await project({
      'src/a.ts': 'export const LIMIT = 3\n',
      'src/index.ts': "import { LIMIT } from './a'\nexport { LIMIT as CAP }\n",
      'src/e.ts': "import { CAP } from './index'\n\nexport function useCap() {\n  return CAP\n}\n",
    })
    const impact = impactOf(edit(root, 'src/a.ts', 'LIMIT = 3', 'LIMIT = 4'), root, architecture, map)
    expect(impact.callers.listed.map((caller) => caller.name)).toEqual(['useCap'])
  })

  it('counts the declaration around an arrow function, and reaches a test that alone imports a changed value', async () => {
    const { root, map, architecture } = await project({
      'src/h.ts': 'export const helper = (n: number) => n + 1\n\nexport const wrapped =\n  (n: number) => n * 2\n\nexport class K {\n  private go = () => 1\n}\n',
      'src/use.ts': "import { helper } from './h'\n\nexport function useIt() {\n  return helper(1)\n}\n",
      'src/lib.ts': 'export const LIMIT = 3\n',
      'src/lib.test.ts': "import { LIMIT } from './lib'\n",
    })
    const name = (from: string, to: string) => changesOf('src/h.ts', fs.readFileSync(path.join(root, 'src/h.ts'), 'utf8'), fs.readFileSync(path.join(root, 'src/h.ts'), 'utf8').replace(from, to)).changes.map((change) => change.name)
    expect(name('export const helper', 'const helper')).toEqual(['helper'])
    expect(name('const helper = ', 'const helper: (n: number) => number = ')).toEqual(['helper'])
    expect(name('private go', 'public go')).toEqual(['K.go'])
    expect(name('(n: number) => n * 2', '(n: number)  =>  n * 2')).toEqual([])
    const unexported = impactOf(edit(root, 'src/h.ts', 'export const helper', 'const helper'), root, architecture, map)
    expect(unexported.callers.listed.map((caller) => caller.name)).toEqual(['useIt'])
    const constant = impactOf(edit(root, 'src/lib.ts', 'LIMIT = 3', 'LIMIT = 4'), root, architecture, map)
    expect(constant.tests.listed).toEqual([{ file: 'src/lib.test.ts', via: 'import', at: 'src/lib.test.ts:1', reaches: 'src/lib.ts' }])
  })

  it('caps the notes and names a few functions per note', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `export function f${i}() { return ${i} }`).join('\n')
    const { root, architecture } = await project({ 'lib/many.ts': `${many}\n` })
    const empty: CodeMap = { root, scannedAt: 0, folders: [] }
    const impact = impactOf({ cwd: root, file: 'lib/many.ts', content: `${many.replaceAll('return', 'return 1 +')}\n` }, root, architecture, empty)
    expect(impact.notes.length).toBeLessThanOrEqual(20)
    expect(impact.notes.some((note) => note.startsWith('30 changed functions are not in the scan (f0 at lib/many.ts:1, f1 at lib/many.ts:2,'))).toBe(true)
  })
})
