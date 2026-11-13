import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from '../contract/graph'
import { scan } from '../scan/scan'
import { cutFor } from '.'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop() as string, { recursive: true, force: true })
})

const contract = (edges: string[]) => parse(['# Demo', '', 'A demo.', '', '## Components', '', '### api', 'Http.', 'owns: `api/**`', '', '### store', 'Data.', 'owns: `store/**`', '', '### jobs', 'Work.', 'owns: `jobs/**`', '', '## Dependencies', '', ...edges.map((edge) => `- ${edge}`), ''].join('\n'))

const FILES: Record<string, string> = {
  'api/handler.ts': "import { load, save } from '../store/db'\n\nexport function handle() {\n  load()\n  return save()\n}\n",
  'store/db.ts': "import { tick } from '../jobs/clock'\n\nexport function load() {\n  return tick()\n}\n\nexport function save() {\n  return 2\n}\n",
  'jobs/clock.ts': 'export function tick() {\n  return 1\n}\n',
}

async function project(files = FILES) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'architect-cut-')))
  roots.push(root)
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  return { root, map: await scan(root) }
}

describe('cutFor', () => {
  it('costs every edge on the cycle and picks the drawn one with the fewest calls, with its call sites and where the callee could go', async () => {
    const { root, map } = await project()
    const cut = await cutFor(contract(['api -> store', 'store -> jobs']), async () => map, root, 'jobs', 'api')
    expect(cut?.path).toEqual(['jobs', 'api', 'store', 'jobs'])
    expect(cut?.edges).toEqual([
      { from: 'jobs', to: 'api', calls: 0, proposed: true },
      { from: 'api', to: 'store', calls: 2, proposed: false },
      { from: 'store', to: 'jobs', calls: 1, proposed: false },
    ])
    expect(cut?.cheapest).toEqual({ from: 'store', to: 'jobs', calls: 1, tie: null, listed: [{ caller: 'store/db.ts:3 load', site: 'store/db.ts:4', callee: 'jobs/clock.ts:1 tick' }] })
    expect(cut?.moves).toHaveLength(1)
    expect(cut?.moves[0]).toMatchObject({ fn: 'jobs/clock.ts:1 tick', component: 'store', status: 'found', folder: 'store' })
  })

  it('breaks a tie by the order on the cycle and says so', async () => {
    const { root, map } = await project({ ...FILES, 'api/handler.ts': "import { load } from '../store/db'\n\nexport function handle() {\n  return load()\n}\n" })
    const cut = await cutFor(contract(['api -> store', 'store -> jobs']), async () => map, root, 'jobs', 'api')
    expect(cut?.cheapest).toMatchObject({ from: 'api', to: 'store', calls: 1, tie: 'api -> store, store -> jobs each have 1 calls; api -> store is picked because it comes first on the cycle after the proposed edge' })
  })

  it('says a drawn edge with no calls can simply be removed, and that a self edge has nothing to cut', async () => {
    const { root, map } = await project({ ...FILES, 'store/db.ts': 'export function load() {\n  return 1\n}\n\nexport function save() {\n  return 2\n}\n' })
    const architecture = contract(['api -> store', 'store -> jobs'])
    const cut = await cutFor(architecture, async () => map, root, 'jobs', 'api')
    expect(cut?.cheapest).toMatchObject({ from: 'store', to: 'jobs', calls: 0, listed: [] })
    expect(cut?.notes[0]).toBe('store -> jobs is drawn but no call between functions crosses it (calls from top level code and imports of values or types are not counted), so it may be removable from architect.md without moving code')
    expect((await cutFor(architecture, async () => map, root, 'api', 'api'))?.notes).toEqual(['api -> api makes api depend on itself, so there is no drawn edge to cut'])
    expect(await cutFor(architecture, async () => map, root, 'api', 'jobs')).toBeUndefined()
  })

  it('keeps cutting until no path is left, and turns a failed or slow scan into a note', async () => {
    const { root, map } = await project({ ...FILES, 'api/jobs.ts': "import { tick } from '../jobs/clock'\n\nexport function a() {\n  return tick()\n}\n\nexport function b() {\n  return tick() + 1\n}\n" })
    const architecture = contract(['api -> store', 'store -> jobs', 'api -> jobs'])
    const cut = await cutFor(architecture, async () => map, root, 'jobs', 'api')
    expect(cut?.path).toEqual(['jobs', 'api', 'jobs'])
    expect(cut?.cheapest).toMatchObject({ from: 'api', to: 'jobs', calls: 2 })
    expect(cut?.also).toEqual([{ from: 'store', to: 'jobs', calls: 1, listed: [{ caller: 'store/db.ts:3 load', site: 'store/db.ts:4', callee: 'jobs/clock.ts:1 tick' }] }])
    expect(cut?.notes[0]).toBe('cutting api -> jobs alone leaves another path from api back to jobs; also lists the cheapest edge on each path left, to cut together')

    const broken = await cutFor(architecture, async () => Promise.reject(new Error('disk gone')), root, 'jobs', 'api')
    expect(broken).toMatchObject({ cheapest: null, notes: ['the cheapest edge to cut could not be worked out: disk gone'] })
    const slow = await cutFor(architecture, () => new Promise(() => {}), root, 'jobs', 'api', 0)
    expect(slow?.notes).toEqual(['the cheapest edge to cut was not worked out: reading the scan took longer than 0 ms'])
  })

  it('prefers one edge that breaks every path when it costs no more than an edge on each path', async () => {
    const parts = ['p', 'q', 'x', 'y', 'z']
    const contractOf = (edges: string[]) => parse(['# Demo', '', 'A demo.', '', '## Components', '', ...parts.flatMap((id) => [`### ${id}`, 'Part.', `owns: \`${id}/**\``, '']), '## Dependencies', '', ...edges.map((edge) => `- ${edge}`), ''].join('\n'))
    const files: Record<string, string> = {
      'q/a.ts': "import { x1, x2 } from '../x/a'\n\nexport function q1() {\n  x1()\n  return x2()\n}\n",
      'x/a.ts': "import { y1 } from '../y/a'\nimport { z1 } from '../z/a'\n\nexport function x1() {\n  return y1()\n}\n\nexport function x2() {\n  return z1()\n}\n",
      'y/a.ts': "import { p1 } from '../p/a'\n\nexport function y1() {\n  return p1()\n}\n",
      'z/a.ts': "import { p1 } from '../p/a'\n\nexport function z1() {\n  return p1()\n}\n",
      'p/a.ts': 'export function p1() {\n  return 1\n}\n',
    }
    const { root, map } = await project(files)
    const cut = await cutFor(contractOf(['q -> x', 'x -> y', 'x -> z', 'y -> p', 'z -> p']), async () => map, root, 'p', 'q')
    expect(cut?.cheapest).toMatchObject({ from: 'q', to: 'x', calls: 2, tie: 'cutting q -> x alone breaks every path for 2 calls, no more than cutting one edge on each path; ties between single edges go to the first by name' })
    expect(cut?.also).toEqual([])
  })
})
