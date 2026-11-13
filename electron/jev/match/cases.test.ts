import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Architecture } from '../../../shared/types'
import { scan } from '../../scan/scan'
import { storeOf, type Store } from '../classify/cache'
import { questionsOf } from '../classify/questions'
import { runIndex, type Ask } from '../classify/run'
import { targetsOf, type Target } from '../classify/targets'
import type { Question, Reply } from '../client'
import { confirmAll } from './confirm'
import { findSame } from './find'
import { behaviorMarkdown } from './render'

const dirs: string[] = []

afterEach(() => {
  while (dirs.length > 0) fs.rmSync(dirs.pop() as string, { recursive: true, force: true })
})

function temp(files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-eval-'))
  dirs.push(root)
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  return root
}

const fn = (name: string, params: string, body: string) => `export function ${name}(${params}) {\n  ${body}\n}\n`

const FILES = {
  'electron/daemon.ts': fn('errorText', 'err: unknown', 'return err instanceof Error ? err.message : String(err)') + fn('loadConfig', 'file: string', 'return { file }'),
  'electron/scan/cache.ts': fn('errorText', 'err: unknown', 'return err instanceof Error ? err.message : String(err)') + fn('saveFile', 'file: string', 'return file'),
  'src/view/canvas.ts': fn('plural', 'n: number, word: string', "return `${n} ${word}${n === 1 ? '' : 's'}`") + fn('renderTitle', 'title: string', 'return title'),
  'src/view/pair.ts': fn('plural', 'count: number, noun: string', "return count === 1 ? `1 ${noun}` : `${count} ${noun}s`"),
  'src/view/list.ts': fn('plural', 'n: number, label: string', "return n + ' ' + label + (n === 1 ? '' : 's')"),
  'electron/where/refs.ts': fn('real', 'file: string', 'return file'),
  'electron/review/index.ts': fn('real', 'at: string', 'return at'),
  'electron/git/churn/numstat.ts': fn('parseNumstat', 'text: string', "return text.split('\\n')"),
  'electron/git/diff/parse.ts': fn('parseDiff', 'text: string', "return text.split('\\n\\n')"),
  'electron/net/send.ts': fn('sendRequest', 'body: object', 'return body') + fn('countLines', 'text: string', "return text.split('\\n').length"),
}

const ARCHITECTURE: Architecture = {
  title: 't',
  summary: 's',
  components: ['daemon', 'scan', 'view', 'where', 'review', 'git', 'net'].map((id) => ({ id, purpose: `The ${id} part.`, owns: [] })),
  edges: [],
  forbidden: [],
  packages: [],
}

const FACETS: Record<string, [string, string, string, string]> = {
  errorText: ['present', 'error', 'text', 'none'],
  plural: ['present', 'number', 'text', 'none'],
  real: ['query', 'path', 'text', 'files'],
  parseNumstat: ['parse', 'text', 'collection', 'none'],
  parseDiff: ['parse', 'text', 'collection', 'none'],
  loadConfig: ['setup', 'path', 'record', 'files'],
  saveFile: ['persist', 'path', 'nothing', 'files'],
  renderTitle: ['present', 'text', 'view', 'screen'],
  sendRequest: ['external', 'record', 'record', 'network'],
  countLines: ['compute', 'text', 'number', 'none'],
}

const componentOf = (file: string) => (file.startsWith('electron/daemon') ? 'daemon' : (file.split('/').find((part) => ARCHITECTURE.components.some((c) => c.id === part)) ?? 'net'))

const JUDGED: Record<string, number> = {
  'electron/git/churn/numstat.ts electron/git/diff/parse.ts': 0.33,
  'src/view/canvas.ts src/view/list.ts': 0.2,
}

type Side = { function: string; file: string }

function judge(first: Side, second: Side): number {
  const pair = [first.file, second.file].sort().join(' ')
  if (pair in JUDGED) return JUDGED[pair] ?? 0
  return first.function === second.function ? 0.92 : 0.05
}

function lean(chosen: string, questions: Question): Record<string, number> {
  const labels = Object.keys(questions.criteria)
  return Object.fromEntries(labels.map((label) => [label, label === chosen ? 0.9 : 0.1 / Math.max(1, labels.length - 1)]))
}

function makeAsk(): ReturnType<typeof vi.fn<Ask>> {
  return vi.fn<Ask>(async (state, questions): Promise<Reply> => {
    const parsed = JSON.parse(state) as { function?: string; file?: string; first?: Side; second?: Side }
    if (parsed.first && parsed.second) return { model: 'jev-1', inputTokens: 300, answers: { same: { type: 'noul', noul: judge(parsed.first, parsed.second) } } }
    const facets = FACETS[parsed.function ?? ''] ?? ['compute', 'text', 'text', 'none']
    const chosen: Record<string, string> = { behavior: facets[0], input: facets[1], output: facets[2], effect: facets[3], responsibility: componentOf(parsed.file ?? '') }
    const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, { type: 'choice' as const, choice: chosen[id] ?? '', probabilities: lean(chosen[id] ?? '', question) }]))
    return { model: 'jev-1', inputTokens: 100, answers }
  })
}

async function indexed() {
  const root = temp(FILES)
  const store = storeOf(temp(), root)
  const map = await scan(root)
  const set = questionsOf(ARCHITECTURE)
  const ask = makeAsk()
  await runIndex({ targets: targetsOf(root, map, set.version).filter((target) => !target.test), set, store, ask, signal: new AbortController().signal, onProgress: () => {} })
  ask.mockClear()
  const search = (file: string, symbol: string, using: Store = store) => findSame({ root, map, architecture: ARCHITECTURE, file, symbol, store: using, ask, signal: new AbortController().signal })
  return { root, map, store, ask, search }
}

const done = async (found: ReturnType<typeof findSame>) => {
  const answer = await found
  if (answer.status !== 'done') throw new Error(answer.reason)
  return answer
}

const pairsAsked = (ask: ReturnType<typeof makeAsk>) => ask.mock.calls.map(([state]) => JSON.parse(state) as { first?: Side; second?: Side }).filter((call) => call.first).map((call) => `${call.second?.file}:${call.second?.function}`)

describe('eval cases', () => {
  it('finds a copy in another component and shows each side its own component as a label', async () => {
    const { search } = await indexed()
    const found = await done(search('electron/daemon.ts', 'errorText'))
    expect(found.responsibility).toBe('daemon')
    expect(found.matches.map((match) => [match.file, match.responsibility, match.structural])).toEqual([['electron/scan/cache.ts', 'scan', false]])
    expect(behaviorMarkdown(found)).toContain('`errorText` at electron/scan/cache.ts:1, 92% same, component scan, found by Jev only.')
  })

  it('sends every copy of a small helper for confirmation, not only the nearest one', async () => {
    const { search, ask } = await indexed()
    await done(search('src/view/pair.ts', 'plural'))
    expect(pairsAsked(ask)).toEqual(expect.arrayContaining(['src/view/canvas.ts:plural', 'src/view/list.ts:plural']))
  })

  it('joins confirmed pairs that share a function into one group, from either side', async () => {
    const { search, ask } = await indexed()
    await done(search('src/view/pair.ts', 'plural'))
    ask.mockClear()

    const group = await done(search('src/view/canvas.ts', 'plural'))
    expect(group.matches.map((match) => [match.file, match.probability, match.via])).toEqual([
      ['src/view/pair.ts', 0.92, null],
      ['src/view/list.ts', 0.92, 'plural'],
    ])
    expect(behaviorMarkdown(group)).toContain('(joined through `plural`)')
    expect(pairsAsked(ask)).toEqual(['src/view/list.ts:plural'])
  })

  it('returns a pair confirmed from the other side even when this side would not pick it', async () => {
    const { search, store, ask } = await indexed()
    const first = await done(search('electron/where/refs.ts', 'real'))
    expect(first.matches.map((match) => match.file)).toEqual(['electron/review/index.ts'])

    const refs = [...store.entries().values()].find((entry) => entry.vector.input?.path === 0.9 && entry.vector.responsibility?.where === 0.9)
    if (!refs) throw new Error('refs real was not indexed')
    store.addEntry({ ...refs, vector: { ...refs.vector, behavior: { external: 1 }, input: { record: 1 } } })
    ask.mockClear()

    const back = await done(search('electron/review/index.ts', 'real'))
    expect(back.matches.map((match) => [match.file, match.probability])).toEqual([['electron/where/refs.ts', 0.92]])
    expect(pairsAsked(ask)).not.toContain('electron/where/refs.ts:real')
  })

  it('lists a near miss from 30 to 50% apart as possible, never as a match', async () => {
    const { search } = await indexed()
    const found = await done(search('electron/git/churn/numstat.ts', 'parseNumstat'))
    expect(found.matches).toEqual([])
    expect(found.possible.map((match) => [match.name, match.probability])).toEqual([['parseDiff', 0.33]])
    expect(found.rejected).toBe(found.candidates - 1)
    const markdown = behaviorMarkdown(found)
    expect(markdown).toContain('No other function was confirmed')
    expect(markdown).toContain('### Possible, not confirmed (30% to 50%)\n- `parseDiff` at electron/git/diff/parse.ts:1, 33% same')
  })

  it('reports indexing progress instead of a dead end while nothing else is classified', async () => {
    const root = temp(FILES)
    const map = await scan(root)
    const run = { status: 'running' as const, total: 14, done: 0, sent: 0, failed: 0 }
    const found = await findSame({ root, map, architecture: ARCHITECTURE, file: 'src/view/pair.ts', symbol: 'plural', store: storeOf(temp(), root), ask: makeAsk(), signal: new AbortController().signal, run })
    expect(found).toEqual({ status: 'unindexed', reason: 'Jev is indexing this project: 0 of 14 functions classified so far, none of the other 13 yet. Ask again in a moment.' })
  })
})

describe('confirmAll', () => {
  const target = (at: number): Target => ({ at, key: `k${at}`, state: '', name: `f${at}`, file: `f${at}.ts`, line: 1, signature: '', inputs: [], output: '', callers: [], callees: [], source: '', test: false })

  it('reuses cached answers for free and spends the guard only on new pairs, counting the rest as unchecked', async () => {
    const root = temp()
    const store = storeOf(temp(), root)
    const ask = makeAsk()
    const subject = target(0)
    const candidates = Array.from({ length: 30 }, (_, i) => target(i + 1))
    const first = await confirmAll(subject, candidates.slice(0, 5), { store, ask, signal: new AbortController().signal, model: 'jev-1', guard: 24 })
    expect(first).toMatchObject({ failed: 0, unchecked: 0 })
    ask.mockClear()

    const again = await confirmAll(subject, candidates, { store, ask, signal: new AbortController().signal, model: 'jev-1', guard: 24 })
    expect(ask).toHaveBeenCalledTimes(24)
    expect(again.checked).toHaveLength(29)
    expect(again.unchecked).toBe(1)
  })
})
