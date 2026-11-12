import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CodeMap } from '../../shared/types'
import { parse } from '../contract/graph'
import { scan } from '../scan/scan'
import { answerWhere, whereOf, type WhereInput } from '.'
import { similarOf } from './similar'
import { leadingWord } from './verb'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop() as string, { recursive: true, force: true })
})

const CONTRACT = [
  '# Demo',
  '',
  'A demo.',
  '',
  '## Components',
  '',
  '### api',
  'The http surface.',
  'owns: `api/**`',
  '',
  '### store',
  'The database.',
  'owns: `store/**`',
  '',
  '### jobs',
  'Background work.',
  'owns: `jobs/**`',
  '',
  '## Dependencies',
  '',
  '- api -> store',
  '- jobs -> store',
  '',
  '## Forbidden',
  '',
  '- store -> api : the store never reaches up',
  '',
  '## Rules',
  '',
  '- files: 3 `store`',
  '',
].join('\n')

const FILES: Record<string, string> = {
  'api/handler.ts': "import { load, save } from '../store/db'\n\nexport function handleGet() {\n  return load()\n}\n\nexport function handlePost() {\n  save()\n  return load()\n}\n",
  'api/view.ts': 'export function render() {\n  return 1\n}\n',
  'store/db.ts': 'export function load() {\n  return 1\n}\n\nexport function save() {\n  return 2\n}\n',
  'store/cache.ts': "import { load } from './db'\n\nexport function loadCached() {\n  return load()\n}\n",
  'store/repo.ts': "import { load } from './db'\n\nexport class Repo {\n  fetch() {\n    return load()\n  }\n}\n",
  'store/db.test.ts': 'function save() {\n  return 0\n}\nsave()\n',
  'jobs/nightly.ts': "import { load } from '../store/db'\n\nexport function runNightly() {\n  return load()\n}\n",
  'lib/util.ts': 'export function render() {\n  return 2\n}\n\nexport function pad() {\n  return 3\n}\n',
}

async function project(withContract = true): Promise<{ root: string; map: CodeMap }> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'architect-where-')))
  roots.push(root)
  for (const [file, content] of Object.entries({ ...FILES, ...(withContract ? { 'architect.md': CONTRACT } : {}) })) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content)
  }
  return { root, map: await scan(root) }
}

async function ask(input: Partial<WhereInput>, withContract = true) {
  const { root, map } = await project(withContract)
  const architecture = withContract ? parse(CONTRACT) : null
  return whereOf({ calls: [], callers: [], ...input }, { root, cwd: root, map, architecture, stale: null })
}

describe('references', () => {
  it('resolves a name, a file, file:name and a method name, and skips test files', async () => {
    const found = await ask({ calls: ['save', 'store/cache.ts', 'store/db.ts:load', 'fetch'] })
    expect(found.calls.map((ref) => [ref.ref, ref.status, ref.matches])).toEqual([
      ['save', 'function', ['store/db.ts:5 save']],
      ['store/cache.ts', 'file', ['store/cache.ts:1']],
      ['store/db.ts:load', 'function', ['store/db.ts:1 load']],
      ['fetch', 'function', ['store/repo.ts:4 Repo.fetch']],
    ])
  })

  it('reads a path relative to the working directory first, then to the project root', async () => {
    const { root, map } = await project()
    const found = whereOf({ calls: ['db.ts', 'store/cache.ts:loadCached', 'api/view.ts'], callers: [] }, { root, cwd: path.join(root, 'store'), map, architecture: parse(CONTRACT), stale: null })
    expect(found.calls.map((ref) => ref.files)).toEqual([['store/db.ts'], ['store/cache.ts'], ['api/view.ts']])
    expect(found.calls[0]).not.toHaveProperty('fns')
  })

  it('picks a method by file:name with its bare name, and counts one function named twice once', async () => {
    const found = await ask({ calls: ['store/repo.ts:fetch', 'load', 'store/db.ts:load'], callers: ['handleGet'] })
    expect(found.calls[0]).toMatchObject({ status: 'function', matches: ['store/repo.ts:4 Repo.fetch'] })
    expect(found.component.reason).toBe('owns 2 of 3 matched neighbours and every call to and from it is allowed')
    expect(found.similar.matches.map((m) => m.name)).not.toContain('handleGet')
  })

  it('reports a name in several files and a name nobody has, and counts neither', async () => {
    const found = await ask({ calls: ['render', 'nope', ' '] })
    expect(found.calls.map((ref) => ref.status)).toEqual(['ambiguous', 'none'])
    expect(found.component.status).toBe('no-match')
    expect(found.folder.path).toBeNull()
    expect(found.similar.status).toBe('none')
    expect(found.notes).toEqual([
      'nope matched no function or file in the scan',
      'render matched 2 functions in different files, pass file:name to pick one: api/view.ts:1 render, lib/util.ts:1 render',
    ])
  })
})

describe('component and folder', () => {
  it('picks the component owning most neighbours, its folder, the leading word and the closest function', async () => {
    const found = await ask({ calls: ['load', 'save'], callers: ['jobs/nightly.ts'], name: 'loadMany' })
    expect(found.component).toMatchObject({ status: 'found', id: 'store', reason: 'owns 2 of 3 matched neighbours and every call to and from it is allowed' })
    expect(found.folder).toMatchObject({ status: 'found', path: 'store', newFile: { fits: false } })
    expect(found.folder.newFile?.violations[0]?.message).toBe('4 code files, the limit is 3: cache.ts, db.ts, new.ts, repo.ts')
    expect(found.verb).toMatchObject({ status: 'found', verb: 'load', reason: 'load leads 2 of 4 function names in store', proposed: { word: 'load', count: 2 } })
    expect(found.similar).toMatchObject({ status: 'found', matches: [{ name: 'handlePost', at: 'api/handler.ts:7' }] })
  })

  it('passes over a component with more neighbours when the drawing does not allow it', async () => {
    const found = await ask({ calls: ['load', 'save', 'runNightly'] })
    expect(found.component.status).toBe('found')
    expect(found.component.id).toBe('jobs')
    expect(found.component.reason).toContain('store own more but would need a dependency')
    expect(found.component.candidates.find((c) => c.component === 'store')?.blocked).toEqual([{ ref: 'runNightly', from: 'store', to: 'jobs', verdict: 'cycle' }])
    expect(found.folder).toMatchObject({ path: 'jobs', newFile: { fits: true } })
  })

  it('reports a tie and a dead end instead of picking', async () => {
    const tied = await ask({ calls: ['load'], callers: ['jobs/nightly.ts'] })
    expect(tied.component).toMatchObject({ status: 'tied', id: null, reason: 'jobs, store each own 1 of 2 matched neighbours' })
    expect(tied.folder.status).toBe('none')
    expect(tied.verb.status).toBe('none')

    const blocked = await ask({ calls: ['handleGet'], callers: ['store/db.ts:load'] })
    expect(blocked.component.status).toBe('blocked')
    expect(blocked.component.candidates.map((c) => c.blocked.map((b) => `${b.from}->${b.to} ${b.verdict}`))).toEqual([['store->api forbidden'], ['store->api forbidden']])
  })

  it('places by folder when no component owns the neighbours or there is no architect.md', async () => {
    const unowned = await ask({ calls: ['pad'] })
    expect(unowned.component.status).toBe('unowned')
    expect(unowned.folder.path).toBe('lib')

    const bare = await ask({ calls: ['load', 'save'], callers: ['api/handler.ts'] }, false)
    expect(bare.component.status).toBe('no-contract')
    expect(bare.folder).toMatchObject({ status: 'found', path: 'store', newFile: { fits: true } })
    expect(bare.notes).toContain('there is no architect.md; rules are the defaults and no dependency was checked')
  })
})

describe('proposed file', () => {
  it('checks the file with a stub, exported unless every caller sits in the same file', async () => {
    const lone = await ask({ calls: ['load'], name: 'loadFresh', file: 'store/cache.ts' })
    expect(lone.file).toMatchObject({ file: 'store/cache.ts', owners: ['store'], fits: false, stub: 'export function loadFresh() {\n}\n' })
    expect(lone.file?.violations.map((v) => v.rule)).toEqual(['jobs'])

    const local = await ask({ calls: ['load'], callers: ['store/cache.ts:loadCached'], name: 'loadFresh', file: 'store/cache.ts' })
    expect(local.file).toMatchObject({ fits: true, stub: 'function loadFresh() {\n  loadCached()\n}\n' })
  })

  it('reports a new file that overfills its folder, a banned name, a name in use and a file outside the project', async () => {
    const full = await ask({ calls: ['load'], name: 'cacheHelper', file: 'store/fresh.ts' })
    expect(full.file?.violations.map((v) => v.rule).sort()).toEqual(['files', 'names'])

    const taken = await ask({ calls: ['load'], name: 'save' })
    expect(taken.notes).toContain('a function named save already exists at store/db.ts:5')

    const outside = await ask({ calls: ['load'], file: '../elsewhere.ts' })
    expect(outside.file).toMatchObject({ fits: false })
    expect(outside.file?.error).toContain('is outside the project')

    const { root, map } = await project()
    const away = whereOf({ calls: ['load'], callers: [], file: 'store/fresh.ts' }, { root, cwd: os.tmpdir(), map, architecture: parse(CONTRACT), stale: null })
    expect(away.file).toMatchObject({ file: 'store/fresh.ts', owners: ['store'] })
    expect(away.file?.error).toBeUndefined()

    const whole = await ask({ calls: ['store/cache.ts'], file: 'store/cache.ts' })
    expect(whole.notes.at(-1)).toContain('store/cache.ts names the whole proposed file')

    const folder = await ask({ calls: ['load'], file: 'store' })
    expect(folder.file?.error).toContain('is not a file')
  })
})

describe('closest function', () => {
  const fns = ['a', 'b', 'c', 'x', 'y', 'caller'].map((name, line) => ({ file: 'f.ts', name, line, test: false }))
  const ref = (name: string, i: number) => ({ ref: name, status: 'function' as const, files: ['f.ts'], fns: [i], matches: [] })

  it('ranks shared callees first, then shared callers, and reports a tie', () => {
    const edges = [[], [], [], [0, 1], [0], [4]]
    expect(similarOf(fns, edges, [ref('a', 0), ref('b', 1)], [ref('caller', 5)]).matches.map((m) => m.name)).toEqual(['x'])
    expect(similarOf(fns, edges, [ref('a', 0)], [ref('caller', 5)]).matches.map((m) => m.name)).toEqual(['y'])
    expect(similarOf(fns, edges, [ref('a', 0)], []).status).toBe('tied')
    expect(similarOf(fns, edges, [ref('c', 2)], []).status).toBe('none')
  })

  it('reads the leading word of camel, pascal, snake and method names', () => {
    expect(['handleGet', 'Repo.fetch', 'HTTPServer', '_private_thing', 'load2', '$'].map(leadingWord)).toEqual(['handle', 'fetch', 'http', 'private', 'load2', null])
  })
})

describe('answerWhere', () => {
  it('answers from the deepest project holding the working directory and refuses one outside every project', async () => {
    const { root, map } = await project(false)
    const load = () => ({ architecture: null, contract: { status: 'missing' as const } })
    const req = { id: '1', op: 'where' as const, cwd: path.join(root, 'store'), calls: ['db.ts:load'], callers: [] }
    const found = await answerWhere(req, [null, '/', root], load, async () => map)
    expect(found.calls[0]).toMatchObject({ status: 'function', matches: ['store/db.ts:1 load'] })
    await expect(answerWhere({ ...req, cwd: os.tmpdir() }, [root], load, async () => map)).rejects.toThrow('is not inside a project')
  })
})
