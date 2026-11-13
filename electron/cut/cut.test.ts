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
    const cut = cutFor(contract(['api -> store', 'store -> jobs']), map, root, 'jobs', 'api')
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
    const cut = cutFor(contract(['api -> store', 'store -> jobs']), map, root, 'jobs', 'api')
    expect(cut?.cheapest).toMatchObject({ from: 'api', to: 'store', calls: 1, tie: 'api -> store, store -> jobs each have 1 calls; api -> store is picked because it comes first on the cycle after the proposed edge' })
  })

  it('says a drawn edge with no calls can simply be removed, and that a self edge has nothing to cut', async () => {
    const { root, map } = await project({ ...FILES, 'store/db.ts': 'export function load() {\n  return 1\n}\n\nexport function save() {\n  return 2\n}\n' })
    const architecture = contract(['api -> store', 'store -> jobs'])
    const cut = cutFor(architecture, map, root, 'jobs', 'api')
    expect(cut?.cheapest).toMatchObject({ from: 'store', to: 'jobs', calls: 0, listed: [] })
    expect(cut?.notes[0]).toBe('store -> jobs is drawn but no call in the scan crosses it, so removing it from architect.md breaks the cycle without moving code')
    expect(cutFor(architecture, map, root, 'api', 'api')?.notes).toEqual(['api -> api makes api depend on itself, so there is no drawn edge to cut'])
    expect(cutFor(architecture, map, root, 'api', 'jobs')).toBeUndefined()
  })
})
