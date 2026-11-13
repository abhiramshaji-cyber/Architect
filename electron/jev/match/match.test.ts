import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SameBehavior } from '../../../shared/jev/types'
import { scan } from '../../scan/scan'
import { storeOf } from '../classify/cache'
import { BEHAVIORS, questionsOf } from '../classify/questions'
import { runIndex, type Ask } from '../classify/run'
import { targetsOf } from '../classify/targets'
import type { Reply } from '../client'
import { findSame } from './find'
import { behaviorMarkdown } from './render'
import { standoutsOf } from './similarity'

const dirs: string[] = []

afterEach(() => {
  while (dirs.length > 0) fs.rmSync(dirs.pop() as string, { recursive: true, force: true })
})

function temp(files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-match-'))
  dirs.push(root)
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  return root
}

const FILES = {
  'store/users.ts': "export function loadUser(id: string): string {\n  return read('users', id)\n}\n\nexport function read(table: string, id: string): string {\n  return table + id\n}\n",
  'store/orders.ts': "import { read } from './users'\n\nexport function fetchOrder(id: string): string {\n  return read('orders', id)\n}\n",
  'billing/accounts.ts': 'export function findAccount(id: string): string {\n  return `account:${id}`\n}\n',
  'api/http.ts': "import { loadUser } from '../store/users'\n\nexport function handleUser(id: string) {\n  return loadUser(id)\n}\n",
  'ui/text.ts': 'export function formatName(name: string): string {\n  return name.trim()\n}\n\nexport function renderPage(title: string): string {\n  return `<h1>${title}</h1>`\n}\n',
}

const LEAN: Record<string, Record<string, number>> = {
  loadUser: { query: 0.9, compute: 0.1 },
  fetchOrder: { query: 0.85, compute: 0.15 },
  findAccount: { query: 0.9, compute: 0.1 },
  read: { query: 0.5, compute: 0.5 },
  handleUser: { respond: 0.9, coordinate: 0.1 },
  formatName: { compute: 0.95, present: 0.05 },
  renderPage: { present: 0.95, compute: 0.05 },
}

const LOOKUPS = new Set(['loadUser', 'fetchOrder', 'findAccount'])

const fakeAsk = vi.fn<Ask>(async (state): Promise<Reply> => {
  const parsed = JSON.parse(state) as { function?: string; first?: { function: string }; second?: { function: string } }
  if (parsed.first && parsed.second) {
    const same = LOOKUPS.has(parsed.first.function) && LOOKUPS.has(parsed.second.function)
    return { model: 'jev-1', inputTokens: 1, answers: { same: { type: 'noul', noul: same ? 0.92 : 0.08 } } }
  }
  const lean = LEAN[parsed.function ?? ''] ?? {}
  const probabilities = Object.fromEntries(Object.keys(BEHAVIORS).map((label) => [label, lean[label] ?? 0]))
  return { model: 'jev-1', inputTokens: 1, answers: { behavior: { type: 'choice', choice: 'query', probabilities } } }
})

async function indexed() {
  const root = temp(FILES)
  const store = storeOf(temp(), root)
  const map = await scan(root)
  const signal = new AbortController().signal
  const set = questionsOf(null)
  const targets = targetsOf(root, map, set.version).filter((target) => !target.test)
  await runIndex({ targets, set, store, ask: fakeAsk, signal, onProgress: () => {} })
  fakeAsk.mockClear()
  return { root, store, map, signal }
}

describe('standoutsOf', () => {
  const entry = (vector: Record<string, Record<string, number>>, model = 'jev-1') => ({ key: 'k', model, at: 0, vector })
  const subject = entry({ behavior: { x: 1, y: 0 } })
  const others = (scores: number[], model?: string) => scores.map((score, at) => ({ at, entry: entry({ behavior: { x: score * score, y: 1 - score * score } }, model) }))

  it('keeps the whole top cluster of a two group split, and every tie when nothing separates them', () => {
    const kept = standoutsOf(subject, others([0.9, 0.88, 0.3, 0.2, 0.1]))
    expect(kept.map((item) => item.at)).toEqual([0, 1])
    expect(kept[0]?.score).toBeCloseTo(0.9)
    expect(standoutsOf(subject, others([0.95, 0.5, 0.45, 0.2, 0.1])).map((item) => item.at)).toEqual([0])
    expect(standoutsOf(subject, others([0.4, 0.4, 0.4, 0.4])).map((item) => item.at)).toEqual([0, 1, 2, 3])
    expect(standoutsOf(subject, others([0, 0, 0]))).toEqual([])
    expect(standoutsOf(subject, [])).toEqual([])
  })

  it('does not starve a small helper whose copies sit on a slope under one stand out', () => {
    const slope = [0.99, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, ...Array.from({ length: 20 }, () => 0.05)]
    expect(standoutsOf(subject, others(slope)).map((item) => item.at)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('compares only answers from the same model and scores behavior alone, never responsibility', () => {
    expect(standoutsOf(subject, others([1, 0.1, 0.1], 'jev-0'))).toEqual([])
    const drawn = entry({ behavior: { x: 1 }, effect: { none: 1 }, responsibility: { api: 1, store: 0 } })
    const scores = standoutsOf(drawn, [
      { at: 0, entry: entry({ behavior: { x: 1 }, effect: { none: 1 }, responsibility: { api: 0, store: 1 } }) },
      { at: 1, entry: entry({ behavior: { x: 1 }, effect: { none: 1 }, responsibility: { api: 1, store: 0 } }) },
      { at: 2, entry: entry({ behavior: { x: 1 }, effect: { files: 1 } }) },
      ...[3, 4, 5].map((at) => ({ at, entry: entry({ behavior: { y: 1 } }) })),
    ])
    expect(scores).toEqual([{ at: 0, score: 1 }, { at: 1, score: 1 }])
  })
})

describe('findSame', () => {
  it('returns only confirmed matches, marks structural ones and the ones Jev alone found', async () => {
    const { root, store, map, signal } = await indexed()
    const found = await findSame({ root, map, architecture: null, file: 'store/users.ts', symbol: 'loadUser', store, ask: fakeAsk, signal })

    expect(found.status).toBe('done')
    if (found.status !== 'done') return
    expect(found.matches.map((match) => [match.name, match.structural])).toEqual([
      ['findAccount', false],
      ['fetchOrder', true],
    ])
    expect(found.matches[0]).toMatchObject({ file: 'billing/accounts.ts', line: 1, probability: 0.92, io: 'same inputs, same output: loadUser(id: string): string vs findAccount(id: string): string' })
    expect(found.rejected).toBe(found.candidates - 2)
    expect(found.possible).toEqual([])
    expect(fakeAsk.mock.calls.every(([state]) => 'first' in JSON.parse(state))).toBe(true)

    fakeAsk.mockClear()
    await findSame({ root, map, architecture: null, file: path.join(root, 'store/users.ts'), symbol: 'loadUser', store, ask: fakeAsk, signal })
    expect(fakeAsk).not.toHaveBeenCalled()

    const markdown = behaviorMarkdown(found)
    expect(markdown).toContain('`findAccount` at billing/accounts.ts:1, 92% same, found by Jev only.')
    expect(markdown).toContain('`fetchOrder` at store/orders.ts:3, 92% same, also a structural match.')
    expect(markdown).toContain('## Same behavior group of `loadUser` (store/users.ts:1)')
  })

  it('names the functions a file has when the symbol is unknown, and waits for an index', async () => {
    const { root, store, map, signal } = await indexed()
    const unknown = await findSame({ root, map, architecture: null, file: 'store/users.ts', symbol: 'nope', store, ask: fakeAsk, signal })
    expect(unknown).toEqual({ status: 'unknown', reason: 'store/users.ts has no function named nope; it has loadUser, read' })

    const empty = await findSame({ root, map, architecture: null, file: 'store/users.ts', symbol: 'loadUser', store: storeOf(temp(), root), ask: fakeAsk, signal })
    expect(empty.status).toBe('unindexed')
    expect(fakeAsk).not.toHaveBeenCalled()
  })

  it('renders the reason alone when there is no answer', () => {
    const off: SameBehavior = { status: 'disabled', reason: 'Jev is off.' }
    expect(behaviorMarkdown(off)).toBe('Jev is off.')
  })
})
