import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { CodeMap, FileEntry } from '../../shared/types'
import { ownership, parse } from '../contract/graph'
import { type AiOutput, type AiRun, draft, evidence, promptFor, skeleton, validate } from './draft'
import { scopeFor, scopeOf } from './scope'

function fn(name: string, line: number, description: string, calls: { file: string; fn: number }[] = []) {
  return { name, line, endLine: line + 4, description, calls }
}

function file(path: string, functions: FileEntry['functions']): FileEntry {
  return { path, functions }
}

function map(files: FileEntry[]): CodeMap {
  return { root: '/repo', scannedAt: 0, folders: [{ path: '', folders: [], files }] }
}

const bot = map([
  file('src/chat/handler.ts', [fn('handle', 1, 'takes a user message', [{ file: 'src/agent/loop.ts', fn: 0 }])]),
  file('src/agent/loop.ts', [fn('think', 1, 'asks the model what to do', [{ file: 'src/tools/search.ts', fn: 0 }])]),
  file('src/tools/search.ts', [fn('search', 1, 'searches the knowledge base')]),
  file('src/data/topics.json', []),
  file('tests/loop.test.ts', [fn('loopTest', 1, 'checks the loop', [{ file: 'src/agent/loop.ts', fn: 0 }])]),
])

const json = (body: unknown) => `Here it is:\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\``

const flowReply = json({
  title: 'bot',
  summary: 'Answers questions from a knowledge base.',
  components: [
    { id: 'channel', purpose: 'Receives user messages.', functions: ['f1'] },
    { id: 'agent', purpose: 'Decides what to do with a message.', functions: ['f2'] },
    { id: 'retrieval', purpose: 'Finds passages in the knowledge base.', functions: ['f3'] },
    { id: 'llm', purpose: 'The model provider.', functions: [] },
  ],
  flows: [
    { from: 'channel', to: 'agent', label: 'user message' },
    { from: 'agent', to: 'retrieval', label: 'search query' },
    { from: 'agent', to: 'llm', label: 'prompt' },
  ],
})

const folderReply = json({
  title: 'bot',
  summary: 'A bot.',
  components: [
    { id: 'src', purpose: 'The bot.', functions: ['f1', 'f2', 'f3'] },
    { id: 'tests', purpose: 'Tests.', functions: ['f4'] },
  ],
  flows: [{ from: 'tests', to: 'src', label: 'calls' }],
})

const ok = (stdout: string): AiOutput => ({ code: 0, stdout, stderr: '', cli: 'claude' })

function replies(...outputs: string[]): { run: AiRun; prompts: string[] } {
  const prompts: string[] = []
  const run: AiRun = async (prompt) => {
    prompts.push(prompt)
    return ok(outputs[Math.min(prompts.length, outputs.length) - 1] ?? '')
  }
  return { run, prompts }
}

describe('evidence', () => {
  it('takes every indexed function with a ref, its summary and its calls', () => {
    const found = evidence(bot)
    expect(found.functions.map((f) => [f.ref, f.row.file, f.row.name])).toEqual([
      ['f1', 'src/chat/handler.ts', 'handle'],
      ['f2', 'src/agent/loop.ts', 'think'],
      ['f3', 'src/tools/search.ts', 'search'],
      ['f4', 'tests/loop.test.ts', 'loopTest'],
    ])
    expect(found.calls).toEqual([
      [0, 1],
      [1, 2],
      [3, 1],
    ])
    expect(found.tops).toEqual(['src', 'tests'])
    expect(found.indexed.has('src/data/topics.json')).toBe(false)
  })

  it('keeps only the functions inside the scope', () => {
    const found = evidence(bot, 'src/agent')
    expect(found.functions.map((f) => f.row.name)).toEqual(['think'])
    expect(found.calls).toEqual([])
  })
})

describe('promptFor', () => {
  it('sends the function index and the call graph, never a folder listing', () => {
    const prompt = promptFor(evidence(bot), 'bot')
    expect(prompt).toContain('f2 | src/agent/loop.ts | think |')
    expect(prompt).toContain('f1 -> f2')
    expect(prompt).toContain('- src/data/topics.json')
    expect(prompt).not.toContain('owns=')
  })

  it('leads with the feedback from a rejected reply', () => {
    expect(promptFor(evidence(bot), 'bot', '', 'Try again.').startsWith('Try again.')).toBe(true)
  })
})

describe('validate', () => {
  it('turns grouped functions into components with labelled flows', () => {
    const result = validate(flowReply, evidence(bot), 'bot')
    if (!result.ok) throw new Error(JSON.stringify(result.error))

    const contract = parse(result.value)
    expect(contract.components.map((c) => [c.id, c.owns, c.covers ?? []])).toEqual([
      ['channel', ['src/chat/**'], ['src/chat/handler.ts#handle']],
      ['agent', ['src/agent/**'], ['src/agent/loop.ts#think']],
      ['retrieval', ['src/tools/**'], ['src/tools/search.ts#search']],
      ['llm', [], []],
    ])
    expect(contract.edges).toEqual([
      { from: 'channel', to: 'agent', label: 'user message' },
      { from: 'agent', to: 'retrieval', label: 'search query' },
      { from: 'agent', to: 'llm', label: 'prompt' },
    ])
  })

  it('draws the call graph between components the reply forgot to connect', () => {
    const reply = json({
      components: [
        { id: 'channel', functions: ['f1'] },
        { id: 'agent', functions: ['f2', 'f3'] },
      ],
      flows: [],
    })
    const result = validate(reply, evidence(bot), 'bot')
    if (!result.ok) throw new Error('expected a draft')
    expect(parse(result.value).edges).toEqual([{ from: 'channel', to: 'agent' }])
  })

  it('drops flows to unknown components, duplicates and flows that close a loop', () => {
    const reply = json({
      components: [
        { id: 'a', functions: ['f1'] },
        { id: 'b', functions: ['f3'] },
      ],
      flows: [
        { from: 'a', to: 'b', label: 'one' },
        { from: 'a', to: 'b', label: 'again' },
        { from: 'b', to: 'a', label: 'back' },
        { from: 'a', to: 'ghost', label: 'nowhere' },
      ],
    })
    const result = validate(reply, evidence(bot), 'bot')
    if (!result.ok) throw new Error('expected a draft')
    expect(parse(result.value).edges).toEqual([{ from: 'a', to: 'b', label: 'one' }])
  })

  it('lets the first component keep a function two components claim and ignores unknown refs', () => {
    const reply = json({
      components: [
        { id: 'one', functions: ['f1', 'f99'] },
        { id: 'two', functions: ['f1', 'f3'] },
      ],
    })
    const result = validate(reply, evidence(bot), 'bot')
    if (!result.ok) throw new Error('expected a draft')
    expect(parse(result.value).components.map((c) => c.covers)).toEqual([
      ['src/chat/handler.ts#handle'],
      ['src/tools/search.ts#search'],
    ])
  })

  it('uses the exact file when its folder is shared and every glob owns only its own files', () => {
    const shared = map([
      file('lib/a.ts', [fn('a', 1, 'reads')]),
      file('lib/b.ts', [fn('b', 1, 'writes')]),
      file('app/[id]/page.ts', [fn('page', 1, 'renders')]),
      file('app/layout.ts', [fn('layout', 1, 'frames')]),
    ])
    const reply = json({
      components: [
        { id: 'reader', functions: ['f1', 'f4'] },
        { id: 'writer', functions: ['f2'] },
        { id: 'page', functions: ['f3'] },
      ],
    })
    const result = validate(reply, evidence(shared), 'shared')
    if (!result.ok) throw new Error('expected a draft')
    const contract = parse(result.value)
    expect(contract.components.map((c) => c.owns)).toEqual([['app/layout.ts', 'lib/a.ts'], ['lib/b.ts'], ['app/[id]/**']])
    const files = shared.folders.flatMap((f) => f.files.map((x) => x.path))
    const owned = ownership(files, contract.components)
    expect(owned.dead).toEqual([])
    expect(owned.multi).toEqual([])
    expect(owned.owned).toContainEqual({ path: 'app/[id]/page.ts', owner: 'page' })
  })

  it('rejects prose, broken JSON and replies whose components cover nothing', () => {
    expect(validate('I think this is a bot.', evidence(bot), 'bot').ok).toBe(false)
    expect(validate('{"components": [', evidence(bot), 'bot').ok).toBe(false)
    expect(validate(json({ components: [{ id: 'llm', functions: [] }] }), evidence(bot), 'bot').ok).toBe(false)
    expect(validate(json({ components: [{ id: 'has space', functions: ['f1'] }] }), evidence(bot), 'bot').ok).toBe(
      false,
    )
  })

  it('falls back to the repo name and a plain summary when the reply gives neither', () => {
    const result = validate(json({ components: [{ id: 'core', functions: ['f1'] }] }), evidence(bot), 'bot')
    if (!result.ok) throw new Error('expected a draft')
    expect(parse(result.value).title).toBe('bot')
    expect(parse(result.value).summary).toBe('The architecture of bot.')
  })
})

describe('draft', () => {
  it('returns the flow chart when the first reply is usable', async () => {
    const { run, prompts } = replies(flowReply)
    const result = await draft('/repo', bot, run)
    expect(result.ok).toBe(true)
    expect(prompts).toHaveLength(1)
  })

  it('rejects a folder tree, tells the model why and keeps the second reply', async () => {
    const { run, prompts } = replies(folderReply, flowReply)
    const result = await draft('/repo', bot, run)
    if (!result.ok) throw new Error('expected a draft')
    expect(parse(result.value).components.map((c) => c.id)).toEqual(['channel', 'agent', 'retrieval', 'llm'])
    expect(prompts[1]).toContain('top level folders (src, tests)')
  })

  it('fails rather than showing a folder tree when the model draws one twice', async () => {
    const { run, prompts } = replies(folderReply)
    const result = await draft('/repo', bot, run)
    expect(prompts).toHaveLength(2)
    expect(result.ok).toBe(false)
    if (result.ok || result.error.kind !== 'unusable') throw new Error('expected an unusable draft')
    expect(result.error.detail).toContain('top level folders')
  })

  it('retries once after an unusable reply', async () => {
    const { run, prompts } = replies('no idea', flowReply)
    expect((await draft('/repo', bot, run)).ok).toBe(true)
    expect(prompts[1]).toContain('could not be used')
  })

  it('drafts a flat repo whose files all sit at the root', async () => {
    const flat = map([file('index.ts', [fn('go', 1, 'starts up')])])
    const result = await draft('/repo', flat, replies(json({ components: [{ id: 'app', functions: ['f1'] }] })).run)
    if (!result.ok) throw new Error('expected a draft')
    expect(parse(result.value).components[0]?.owns).toEqual(['index.ts'])
  })

  it('reports nothing to draft from and never asks the agent when no function was indexed', async () => {
    const { run, prompts } = replies(flowReply)
    const result = await draft('/repo', map([file('README.md', [])]), run)
    expect(result).toEqual({ ok: false, error: { kind: 'nothing-to-draft' } })
    expect(prompts).toHaveLength(0)
  })

  it('reports the agent as not installed', async () => {
    const result = await draft('/repo', bot, async () => ({ code: 'missing', stdout: '', stderr: '', cli: 'claude' }))
    expect(result).toEqual({ ok: false, error: { kind: 'not-installed', cli: 'claude' } })
  })

  it('reports a timed out agent', async () => {
    const result = await draft('/repo', bot, async () => ({ code: 'timeout', stdout: '', stderr: '', cli: 'claude' }))
    expect(result).toEqual({ ok: false, error: { kind: 'timed-out', cli: 'claude' } })
  })

  it('reports a failing agent with its exit code and stderr', async () => {
    const result = await draft('/repo', bot, async () => ({ code: 3, stdout: '', stderr: ' no credit left \n', cli: 'claude' }))
    expect(result).toEqual({ ok: false, error: { kind: 'failed', code: 3, stderr: 'no credit left', cli: 'claude' } })
  })

  it('runs the agent in the repo it is drafting for', async () => {
    let where = ''
    await draft('/repo', bot, async (_prompt, cwd) => {
      where = cwd
      return ok(flowReply)
    })
    expect(where).toBe('/repo')
  })
})

const monorepo = map([
  file('spec/bot/src/agent.ts', [fn('agent', 1, 'answers a shopper', [{ file: 'spec/frontend/src/app.ts', fn: 0 }])]),
  file('spec/bot/src/tools.ts', [fn('lookup', 1, 'looks up an order')]),
  file('spec/frontend/src/app.ts', [fn('app', 1, 'renders the portal')]),
  file('spec/README.md', []),
  file('zing/bot/src/main.ts', [fn('main', 1, 'runs another client')]),
  file('adssys/index.ts', [fn('index', 1, 'serves ads')]),
])

const scopedReply = json({
  title: 'spec',
  summary: 'A delivery bot and its portal.',
  components: [
    { id: 'shopper-agent', purpose: 'Answers shoppers.', functions: ['f1'] },
    { id: 'orders', purpose: 'Looks up orders.', functions: ['f2'] },
    { id: 'portal', purpose: 'Renders the portal.', functions: ['f3'] },
  ],
  flows: [
    { from: 'shopper-agent', to: 'portal', label: 'answer' },
    { from: 'shopper-agent', to: 'orders', label: 'order id' },
  ],
})

describe('scoped draft', () => {
  it('drafts only the functions under the scope with globs relative to the repo root', async () => {
    const { run, prompts } = replies(scopedReply)
    const result = await draft('/repo', monorepo, run, 'spec')
    if (!result.ok) throw new Error('expected a draft')

    const contract = parse(result.value)
    expect(contract.scope).toBe('spec')
    expect(contract.components.map((c) => [c.id, c.owns])).toEqual([
      ['shopper-agent', ['spec/bot/src/agent.ts']],
      ['orders', ['spec/bot/src/tools.ts']],
      ['portal', ['spec/frontend/**']],
    ])
    expect(contract.edges).toEqual([
      { from: 'shopper-agent', to: 'portal', label: 'answer' },
      { from: 'shopper-agent', to: 'orders', label: 'order id' },
    ])
    expect(prompts[0]).toContain('at spec/')
    expect(prompts[0]).not.toContain('zing')
    expect(prompts[0]).not.toContain('adssys')
  })

  it('falls back to the whole repo when the scope holds no function', async () => {
    const { run, prompts } = replies(scopedReply)
    await draft('/repo', monorepo, run, 'spec/README.md')
    expect(prompts[0]).toContain('zing/bot/src/main.ts')
  })
})

describe('skeleton', () => {
  it('starts a hand written contract from the top level folders', () => {
    expect(skeleton(monorepo).map((c) => [c.id, c.owns])).toEqual([
      ['adssys', ['adssys/**']],
      ['spec', ['spec/**']],
      ['zing', ['zing/**']],
    ])
  })
})

describe('scopeFor', () => {
  const projects = new Set(['spec/bot', 'spec/frontend', 'zing', 'zing/bot'])
  const isProject = (dir: string) => projects.has(dir)

  it('scopes to the one project the changes sit in', () => {
    expect(scopeFor(['spec/bot/src/a.ts', 'spec/bot/agent.config.ts'], isProject)).toBe('spec/bot')
  })

  it('scopes to the folder that holds every project the changes touch', () => {
    expect(scopeFor(['spec/bot/src/a.ts', 'spec/frontend/src/format.ts'], isProject)).toBe('spec')
    expect(scopeFor(['zing/bot/a.ts', 'zing/b.ts'], isProject)).toBe('zing')
  })

  it('keeps the whole repo when nothing changed', () => {
    expect(scopeFor([], isProject)).toBe('')
  })

  it('keeps the whole repo when changes span unrelated projects', () => {
    expect(scopeFor(['spec/bot/a.ts', 'zing/b.ts'], isProject)).toBe('')
  })

  it('keeps the whole repo when a change belongs to the root project', () => {
    expect(scopeFor(['package.json'], isProject)).toBe('')
    expect(scopeFor(['spec/bot/a.ts', 'docs/notes.md'], isProject)).toBe('')
  })
})

describe('scopeOf', () => {
  const roots: string[] = []
  afterAll(() => roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  }
  const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' })
  const write = (root: string, rel: string, text = 'x\n') => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), text)
  }
  const tmp = () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'architect-scope-')))
    roots.push(root)
    return root
  }

  function repo(files: string[]): string {
    const root = tmp()
    sh(root, 'init', '-q', '-b', 'main')
    for (const rel of files) write(root, rel)
    sh(root, 'add', '-A')
    sh(root, 'commit', '-q', '-m', 'init')
    return root
  }

  const mono = [
    'package.json',
    'spec/bot/package.json',
    'spec/bot/src/a.ts',
    'spec/frontend/package.json',
    'spec/frontend/src/b.ts',
    'zing/package.json',
    'zing/c.ts',
  ]

  it('keeps the whole repo when nothing changed', async () => {
    expect(await scopeOf(repo(mono))).toBe('')
  })

  it('scopes a monorepo to the subprojects holding the uncommitted and untracked work', async () => {
    const root = repo(mono)
    write(root, 'spec/bot/src/a.ts', 'y\n')
    write(root, 'spec/frontend/src/new.ts')
    expect(await scopeOf(root)).toBe('spec')
  })

  it('scopes on a detached head with no trunk to diff against', async () => {
    const root = repo(mono)
    sh(root, 'checkout', '-q', '--detach')
    write(root, 'spec/bot/src/a.ts', 'y\n')
    expect(await scopeOf(root)).toBe('spec/bot')
  })

  it('scopes to the commits a branch made against its trunk', async () => {
    const trunk = repo(mono)
    const root = tmp()
    sh(root, 'clone', '-q', trunk, '.')
    sh(root, 'checkout', '-q', '-b', 'spec/bot')
    write(root, 'spec/bot/src/a.ts', 'y\n')
    sh(root, 'commit', '-q', '-am', 'work')
    expect(await scopeOf(root)).toBe('spec/bot')
  })

  it('keeps the whole repo when the changes span unrelated projects or sit at the root', async () => {
    const spread = repo(mono)
    write(spread, 'spec/bot/src/a.ts', 'y\n')
    write(spread, 'zing/c.ts', 'y\n')
    expect(await scopeOf(spread)).toBe('')

    const rooted = repo(mono)
    write(rooted, 'package.json', '{}\n')
    expect(await scopeOf(rooted)).toBe('')
  })

  it('keeps the whole repo for a plain single project repo', async () => {
    const root = repo(['package.json', 'src/a.ts', 'src/deep/b.ts'])
    write(root, 'src/deep/b.ts', 'y\n')
    expect(await scopeOf(root)).toBe('')
  })
})
