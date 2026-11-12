import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Architecture } from '../../shared/types'
import { MARKER } from './render'
import { hasAgents, writeAgents } from './write'

const roots: string[] = []

function project(folders: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-agents-'))
  roots.push(root)
  for (const folder of folders) fs.mkdirSync(path.join(root, folder), { recursive: true })
  return root
}

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop() as string, { recursive: true, force: true })
})

const arch = (ids: string[]): Architecture => ({
  title: 'T',
  summary: 'S',
  components: ids.map((id) => ({ id, purpose: `${id} things`, owns: [`src/${id}/**`] })),
  edges: [],
  forbidden: [],
  packages: [],
})

const read = (root: string, file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('writeAgents', () => {
  it('writes one AGENTS.md per placed component and nothing the second time', () => {
    const root = project(['src/api', 'src/db'])
    expect(hasAgents(root)).toBe(false)

    expect(writeAgents(root, arch(['api', 'db']))).toEqual({ written: ['src/api/AGENTS.md', 'src/db/AGENTS.md'], unchanged: [], removed: [], kept: [], unplaced: [] })
    expect(read(root, 'src/api/AGENTS.md').startsWith(`${MARKER}\n# api\n`)).toBe(true)
    expect(hasAgents(root)).toBe(true)

    const before = fs.statSync(path.join(root, 'src/api/AGENTS.md')).mtimeMs
    expect(writeAgents(root, arch(['api', 'db']))).toEqual({ written: [], unchanged: ['src/api/AGENTS.md', 'src/db/AGENTS.md'], removed: [], kept: [], unplaced: [] })
    expect(fs.statSync(path.join(root, 'src/api/AGENTS.md')).mtimeMs).toBe(before)
  })

  it('rewrites a generated file whose contract changed and removes one whose component is gone', () => {
    const root = project(['src/api', 'src/db'])
    writeAgents(root, arch(['api', 'db']))
    const changed = arch(['api'])
    changed.components[0] = { id: 'api', purpose: 'new purpose', owns: ['src/api/**'] }

    expect(writeAgents(root, changed)).toMatchObject({ written: ['src/api/AGENTS.md'], removed: ['src/db/AGENTS.md'] })
    expect(read(root, 'src/api/AGENTS.md')).toContain('new purpose')
    expect(fs.existsSync(path.join(root, 'src/db/AGENTS.md'))).toBe(false)
  })

  it('never overwrites or removes an AGENTS.md written by hand', () => {
    const root = project(['src/api', 'src/old'])
    fs.writeFileSync(path.join(root, 'src/api/AGENTS.md'), '# my notes\n')
    fs.writeFileSync(path.join(root, 'src/old/AGENTS.md'), '# other notes\n')
    fs.writeFileSync(path.join(root, 'AGENTS.md'), `${MARKER}\nroot\n`)

    expect(writeAgents(root, arch(['api']))).toMatchObject({ written: [], kept: ['src/api/AGENTS.md'], removed: [] })
    expect(read(root, 'src/api/AGENTS.md')).toBe('# my notes\n')
    expect(read(root, 'src/old/AGENTS.md')).toBe('# other notes\n')
    expect(read(root, 'AGENTS.md')).toBe(`${MARKER}\nroot\n`)
  })

  it('reports a folder that does not exist and leaves ignored folders alone', () => {
    const root = project(['node_modules/pkg', '.github/x'])
    fs.writeFileSync(path.join(root, 'node_modules/pkg/AGENTS.md'), `${MARKER}\n`)
    fs.writeFileSync(path.join(root, '.github/x/AGENTS.md'), `${MARKER}\n`)

    expect(writeAgents(root, arch(['api']))).toEqual({ written: [], unchanged: [], removed: [], kept: [], unplaced: [{ component: 'api', reason: 'src/api does not exist' }] })
    expect(fs.existsSync(path.join(root, 'node_modules/pkg/AGENTS.md'))).toBe(true)
    expect(hasAgents(root)).toBe(false)
  })
})
