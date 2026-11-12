import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Architecture, CodeMap } from '../../shared/types'
import { parse } from '../contract/graph'
import { scan } from '../scan/scan'
import { impactFor, impactOf, type ImpactInput } from '.'
import { reachOf } from './callers'
import { importLine } from './tests'
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
    expect(changesOf('x.ts', before, after)).toEqual({
      changes: [
        { name: 'a', nth: 1, line: 4, change: 'changed' },
        { name: 'gone', nth: 0, line: 7, change: 'removed' },
        { name: 'fresh', nth: 0, line: 7, change: 'added' },
      ],
      parsed: 6,
    })
  })

  it('touches nothing when only code outside every function changes', () => {
    expect(changesOf('x.ts', 'const a = 1\nfunction f() {}\n', 'const a = 2\nfunction f() {}\n').changes).toEqual([])
  })
})

describe('reachOf', () => {
  it('walks callers once each through a cycle, nearest depth first', () => {
    const reach = reachOf([[1], [2], [0], [2]], [0])
    expect([...reach.depth]).toEqual([[0, 0], [2, 1], [1, 2], [3, 2]])
    expect(reach.parent.get(3)).toBe(2)
  })
})

describe('impactOf', () => {
  it('counts transitive callers per depth with evidence, stopping the list at depth three', async () => {
    const { root, map, architecture } = await project()
    const impact = impactOf(edit(root, 'store/db.ts', 'return 1', 'return 9'), root, architecture, map)

    expect(impact.touched).toEqual({ total: 1, listed: [{ name: 'load', change: 'changed', at: 'store/db.ts:1' }] })
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
    expect(impact.notes).toEqual(['1 of 4 callers are counted in depths but not listed; the list stops at depth 3 or 40 callers'])
    expect(impact.components).toEqual([
      { id: 'api', functions: 2, first: 'api/handler.ts:3' },
      { id: 'store', functions: 2, first: 'store/cache.ts:3' },
      { id: 'both', functions: 1, first: 'store/db.ts:1' },
      { id: null, functions: 1, first: 'lib/top.ts:3' },
    ])
  })

  it('finds the tests that call or import what is reached, with the line', async () => {
    const { root, map, architecture } = await project()
    const impact = impactOf(edit(root, 'store/db.ts', 'return 1', 'return 9'), root, architecture, map)

    expect(impact.tests).toEqual({
      total: 2,
      listed: [
        { file: 'api/handler.test.ts', via: 'call', at: 'api/handler.test.ts:3', reaches: 'store/cache.ts:3' },
        { file: 'store/db.test.ts', via: 'import', at: 'store/db.test.ts:1', reaches: 'store/db.ts:1' },
      ],
    })
    expect(impact.callers.listed.some((caller) => caller.at.includes('.test.'))).toBe(false)
  })

  it('ends on a call cycle and reports a new function with no callers', async () => {
    const { root, map, architecture } = await project()
    const looped = impactOf(edit(root, 'store/db.ts', 'return 2', 'return 8'), root, architecture, map)
    expect(looped.callers.depths).toEqual([{ depth: 1, count: 1, first: 'lib/loop.ts:3 ping' }, { depth: 2, count: 1, first: 'lib/loop.ts:8 pong' }])

    const added = impactOf(edit(root, 'api/route.ts', 'export function route', 'export function extra() {}\n\nexport function route'), root, architecture, map)
    expect(added.touched.listed).toEqual([{ name: 'extra', change: 'added', at: 'api/route.ts:3' }])
    expect(added.callers.total).toBe(0)
    expect(added.components).toEqual([{ id: 'api', functions: 1, first: 'api/route.ts:3' }])
    expect(added.tests).toEqual({ total: 0, listed: [] })

    const tested = impactOf(edit(root, 'store/db.ts', 'export function load', 'export function extra() {}\n\nexport function load'), root, architecture, map)
    expect(tested.tests.listed).toContainEqual({ file: 'store/db.test.ts', via: 'import', at: 'store/db.test.ts:1', reaches: 'store/db.ts:1' })
    expect(impactOf({ cwd: root, file: 'store/db.ts', content: fs.readFileSync(path.join(root, 'store/db.ts'), 'utf8') }, root, architecture, map).tests.total).toBe(0)
  })

  it('says why nothing is touched', async () => {
    const { root, map, architecture } = await project({ ...FILES, 'notes.md': '# notes\n' })
    fs.mkdirSync(path.join(root, 'dir.ts'))
    const notes = (input: ImpactInput) => impactOf(input, root, architecture, map).notes

    expect(notes({ cwd: root, file: '../out.ts', content: 'x' })).toEqual([`../out.ts is outside ${root}, so no function is touched`])
    expect(notes({ cwd: root, file: 'notes.md', content: '# more\n' })).toEqual(['notes.md holds no function the scan parses, so no function is touched'])
    expect(notes(edit(root, 'store/cache.ts', "'./db'", '"./db"'))).toEqual(['the change to store/cache.ts is outside every function, so no function is touched'])
    expect(notes({ cwd: root, file: 'dir.ts', content: 'x' })).toEqual(['dir.ts could not be read (dir.ts is not a file), so no function is touched'])
    expect(notes({ cwd: path.join(root, 'api'), file: 'route.ts', content: fs.readFileSync(path.join(root, 'api/route.ts'), 'utf8') })).toEqual(['the proposed content of api/route.ts is the same as the file on disk, so no function is touched'])
  })

  it('notes a changed function the scan has not seen yet', async () => {
    const { root, architecture } = await project()
    const empty: CodeMap = { root, scannedAt: 0, folders: [] }
    expect(impactOf(edit(root, 'store/db.ts', 'return 1', 'return 9'), root, architecture, empty).notes).toEqual(['load at store/db.ts:1 is not in the last scan, so its callers are not counted'])
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
  it('uses a current stored scan, rescans a stale one, and reports a failure', async () => {
    const { root, map, architecture } = await project()
    const input = edit(root, 'store/db.ts', 'return 1', 'return 9')
    const fake: CodeMap = { ...map, scannedAt: Date.now() + 60_000, folders: map.folders.filter((folder) => folder.path !== 'api') }
    expect((await impactFor(input, root, architecture, fake)).callers.total).toBe(1)

    const stale = { ...fake, scannedAt: 0 }
    expect((await impactFor(input, root, architecture, stale)).callers.total).toBe(4)
    expect((await impactFor(input, root, architecture, null)).callers.total).toBe(4)

    const broken = await impactFor(input, root, {} as Architecture, map)
    expect(broken.notes[0]).toMatch(/^impact could not be worked out: /)
    expect(broken.callers.total).toBe(0)
  })
})

describe('importLine', () => {
  it('finds the line importing the file and nothing for a missing file or an alias', async () => {
    const { root } = await project({ 'a/b.ts': 'export const b = 1\n', 'a/b.test.ts': "import x from 'vitest'\nexport * from './b.js'\n", 'a/c.test.ts': "import { b } from '@/a/b'\n" })
    expect(importLine(root, 'a/b.test.ts', 'a/b.ts')).toBe(2)
    expect(importLine(root, 'a/c.test.ts', 'a/b.ts')).toBeNull()
    expect(importLine(root, 'a/none.test.ts', 'a/b.ts')).toBeNull()
  })
})
