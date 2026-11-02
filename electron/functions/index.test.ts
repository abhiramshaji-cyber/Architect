import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodeMap, FileEntry, FunctionsReport } from '../../shared/types'
import type { ClaudeOutput, ClaudeRun } from '../draft/draft'
import { createRanking } from './index'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function project(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-rank-'))
  dirs.push(root)
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(root, file), text)
  return root
}

function mapOf(root: string, files: FileEntry[]): CodeMap {
  return { root, scannedAt: 0, folders: [{ path: '', folders: [], files }] }
}

const entry = (file: string, names: string[]): FileEntry => ({
  path: file,
  functions: names.map((name, i) => ({
    name,
    line: i + 1,
    endLine: i + 1,
    description: '',
    calls: [],
  })),
})

function answering(prompt: string): ClaudeOutput {
  const ids = [...prompt.matchAll(/id="(f\d+)"/g)].map((m) => m[1])
  return {
    code: 0,
    stdout: JSON.stringify(ids.map((id) => ({ id, importance: 4, summary: 'Keeps things tidy.' }))),
    stderr: '',
  }
}

function setup(run: ClaudeRun) {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-rank-cache-'))
  dirs.push(cacheDir)
  const reports: FunctionsReport[] = []
  const ranking = createRanking(
    (root) => path.join(cacheDir, `${path.basename(root)}.json`),
    run,
    (r) => reports.push(r),
  )
  return { ranking, reports }
}

const settle = (reports: FunctionsReport[]) =>
  vi.waitFor(() => {
    const last = reports.at(-1)
    if (!last || last.done < last.total) throw new Error('still ranking')
    return last
  })

describe('createRanking', () => {
  it('shows every function from facts at once, then ranks each file and caches it', async () => {
    const root = project({ 'a.ts': 'a\nb', 'b.ts': 'c' })
    const map = mapOf(root, [entry('a.ts', ['a', 'b']), entry('b.ts', ['c'])])
    const run = vi.fn(async (prompt: string) => answering(prompt))
    const { ranking, reports } = setup(run)

    const first = await ranking.rank(root, map)
    expect(first.rows.map((r) => [r.name, r.rank])).toEqual([
      ['a', null],
      ['b', null],
      ['c', null],
    ])
    expect(first.total).toBe(2)

    const last = await settle(reports)
    expect(run).toHaveBeenCalledTimes(2)
    expect(last.rows.every((r) => r.rank?.importance === 4)).toBe(true)
    expect(last).toMatchObject({ done: 2, total: 2, failed: 0, failure: null })

    await vi.waitFor(() => expect(ranking.rank(root, map)).resolves.toMatchObject({ done: 2 }))
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('asks again only for the file whose content changed', async () => {
    const root = project({ 'a.ts': 'a', 'b.ts': 'b' })
    const map = mapOf(root, [entry('a.ts', ['a']), entry('b.ts', ['b'])])
    const run = vi.fn(async (prompt: string) => answering(prompt))
    const { ranking, reports } = setup(run)

    await ranking.rank(root, map)
    await settle(reports)
    await vi.waitFor(() => expect(ranking.rank(root, map)).resolves.toMatchObject({ done: 2 }))
    run.mockClear()

    fs.writeFileSync(path.join(root, 'b.ts'), 'b changed')
    reports.length = 0
    const again = await ranking.rank(root, map)
    expect(again.rows.find((r) => r.name === 'a')?.rank).not.toBeNull()
    await settle(reports)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[0]).toContain('b.ts')
  })

  it('reports a missing Claude Code once and finishes without asking for the remaining files', async () => {
    const root = project({
      'a.ts': 'a',
      'b.ts': 'b',
      'c.ts': 'c',
      'd.ts': 'd',
    })
    const map = mapOf(root, [entry('a.ts', ['a']), entry('b.ts', ['b']), entry('c.ts', ['c']), entry('d.ts', ['d'])])
    const run = vi.fn(async () => ({
      code: 'missing' as const,
      stdout: '',
      stderr: '',
    }))
    const { ranking, reports } = setup(run)

    await ranking.rank(root, map)
    const last = await settle(reports)
    expect(last.failure).toEqual({ kind: 'not-installed' })
    expect(last.failed).toBe(4)
    expect(run.mock.calls.length).toBeLessThanOrEqual(3)
  })

  it('leaves a deleted file unranked without calling Claude and handles a project with no functions', async () => {
    const root = project({ 'a.ts': 'a' })
    const run = vi.fn(async (prompt: string) => answering(prompt))
    const { ranking, reports } = setup(run)

    const report = await ranking.rank(root, mapOf(root, [entry('a.ts', ['a']), entry('gone.ts', ['g'])]))
    expect(report.rows.find((r) => r.name === 'g')?.rank).toBeNull()
    const last = await settle(reports)
    expect(run).toHaveBeenCalledTimes(1)
    expect(last.rows.find((r) => r.name === 'g')?.rank).toBeNull()

    const empty = project({})
    await expect(ranking.rank(empty, mapOf(empty, []))).resolves.toMatchObject({
      rows: [],
      done: 0,
      total: 0,
    })
  })

  it('stops emitting and calling once the project is closed mid rank', async () => {
    const root = project({
      'a.ts': 'a',
      'b.ts': 'b',
      'c.ts': 'c',
      'd.ts': 'd',
      'e.ts': 'e',
    })
    const map = mapOf(
      root,
      ['a', 'b', 'c', 'd', 'e'].map((n) => entry(`${n}.ts`, [n])),
    )
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const run = vi.fn(async (prompt: string, _cwd: string, _t?: number, _m?: string, signal?: AbortSignal) => {
      await gate
      return signal?.aborted ? { code: 'timeout' as const, stdout: '', stderr: '' } : answering(prompt)
    })
    const { ranking, reports } = setup(run)

    await ranking.rank(root, map)
    const seen = reports.length
    ranking.stop(root)
    release()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(reports.length).toBe(seen)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('reruns with the newest map when one arrives during a rank', async () => {
    const root = project({ 'a.ts': 'a', 'b.ts': 'b' })
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const run = vi.fn(async (prompt: string) => {
      await gate
      return answering(prompt)
    })
    const { ranking, reports } = setup(run)

    await ranking.rank(root, mapOf(root, [entry('a.ts', ['a'])]))
    await ranking.rank(root, mapOf(root, [entry('a.ts', ['a']), entry('b.ts', ['b'])]))
    release()

    await vi.waitFor(() => {
      const last = reports.at(-1)
      if (!last || last.total !== 2 || last.done < 2) throw new Error('waiting for the rerun')
    })
    expect(reports.at(-1)?.rows.map((r) => r.name)).toEqual(['a', 'b'])
  })
})
