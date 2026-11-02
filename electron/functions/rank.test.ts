import { describe, expect, it, vi } from 'vitest'
import type { FunctionFacts } from '../../shared/types'
import type { ClaudeOutput, ClaudeRun } from '../draft/draft'
import { FUNCTIONS_PER_CALL } from './prompt'
import { rankFile } from './rank'

const facts = (count: number): FunctionFacts[] =>
  Array.from({ length: count }, (_, i) => ({
    file: 'a.ts',
    name: `fn${i}`,
    line: i + 1,
    lines: 1,
    fanIn: 0,
    fanOut: 0,
    exported: false,
    entry: false,
  }))

const text = (count: number) => Array.from({ length: count }, (_, i) => `function fn${i}() {}`).join('\n')

function answering(prompt: string): ClaudeOutput {
  const ids = [...prompt.matchAll(/id="(f\d+)"/g)].map((m) => m[1])
  return {
    code: 0,
    stdout: JSON.stringify(ids.map((id) => ({ id, importance: 2, summary: `Does ${id}.` }))),
    stderr: '',
  }
}

describe('rankFile', () => {
  it('splits a large file into bounded calls and never drops a function', async () => {
    const count = FUNCTIONS_PER_CALL * 2 + 3
    const run = vi.fn<ClaudeRun>(async (prompt) => answering(prompt))

    const result = await rankFile('demo', '/r', 'a.ts', facts(count), text(count), run)

    expect(run).toHaveBeenCalledTimes(3)
    expect(run.mock.calls[0]?.[3]).toBe('haiku')
    expect(result.failure).toBeNull()
    expect(result.ranks).toHaveLength(count)
    expect(result.ranks.every((rank) => rank !== null)).toBe(true)
    expect(result.ranks[count - 1]).toEqual({
      importance: 2,
      summary: `Does f${count - 1}.`,
    })
  })

  it('stops at once when Claude Code is not installed', async () => {
    const run = vi.fn(async () => ({
      code: 'missing' as const,
      stdout: '',
      stderr: '',
    }))
    const result = await rankFile('demo', '/r', 'a.ts', facts(FUNCTIONS_PER_CALL + 1), text(1), run)

    expect(run).toHaveBeenCalledTimes(1)
    expect(result.failure).toEqual({ kind: 'not-installed' })
    expect(result.ranks.every((rank) => rank === null)).toBe(true)
  })

  it('reports a timeout, a crash and an unreadable reply, leaving those functions unranked', async () => {
    const timeout = await rankFile('d', '/r', 'a.ts', facts(1), text(1), async () => ({
      code: 'timeout',
      stdout: '',
      stderr: '',
    }))
    expect(timeout).toEqual({ ranks: [null], failure: { kind: 'timed-out' } })

    const crash = await rankFile('d', '/r', 'a.ts', facts(1), text(1), async () => ({
      code: 2,
      stdout: '',
      stderr: '  boom  ',
    }))
    expect(crash).toEqual({
      ranks: [null],
      failure: { kind: 'failed', code: 2, stderr: 'boom' },
    })

    const junk = await rankFile('d', '/r', 'a.ts', facts(1), text(1), async () => ({
      code: 0,
      stdout: 'sorry',
      stderr: '',
    }))
    expect(junk.ranks).toEqual([null])
    expect(junk.failure?.kind).toBe('unusable')
  })

  it('keeps the functions it got back when the reply covers only some of them', async () => {
    const run = async () => ({
      code: 0,
      stdout: '[{"id":"f1","importance":5,"summary":"Runs the app."}]',
      stderr: '',
    })
    const result = await rankFile('d', '/r', 'a.ts', facts(2), text(2), run)
    expect(result).toEqual({
      ranks: [null, { importance: 5, summary: 'Runs the app.' }],
      failure: null,
    })
  })

  it('makes no call once the work is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const run = vi.fn(async (prompt: string) => answering(prompt))
    await rankFile('d', '/r', 'a.ts', facts(2), text(2), run, controller.signal)
    expect(run).not.toHaveBeenCalled()
  })
})
