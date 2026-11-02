import fs from 'node:fs'
import path from 'node:path'
import { pooled } from '../../shared/pool'
import type { CodeMap, DraftFailure, FunctionFacts, FunctionRank, FunctionsReport } from '../../shared/types'
import type { ClaudeRun } from '../draft/draft'
import { hashOf, hit, keysOf, readCache, writeCache, type RankCache } from './cache'
import { declaredEntries, factsOf } from './facts'
import { rankFile } from './rank'

const LANES = 3

type Run = { controller: AbortController; report: FunctionsReport; busy: boolean; again: CodeMap | null }

type Group = { file: string; facts: FunctionFacts[]; offset: number }

type Job = Group & { text: string; hash: string }

function manifestOf(root: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

function byFile(facts: FunctionFacts[]): Group[] {
  const groups: Group[] = []
  facts.forEach((f, at) => {
    const last = groups.at(-1)
    if (last?.file === f.file) last.facts.push(f)
    else groups.push({ file: f.file, facts: [f], offset: at })
  })
  return groups
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createRanking(
  cacheFileOf: (root: string) => string,
  run: ClaudeRun,
  emit: (report: FunctionsReport) => void,
) {
  const runs = new Map<string, Run>()

  async function pass(root: string, map: CodeMap, state: Run, ready: (report: FunctionsReport) => void) {
    const { signal } = state.controller
    const facts = factsOf(map, declaredEntries(manifestOf(root)))
    const groups = byFile(facts)
    const rows = facts.map((f) => ({ ...f, rank: null }))
    const report: FunctionsReport = { root, rows, done: 0, total: groups.length, failed: 0, failure: null }
    const publish = () => {
      state.report = { ...report, rows: [...report.rows] }
      if (!signal.aborted) emit(state.report)
    }
    const place = (offset: number, ranks: (FunctionRank | null)[]) =>
      ranks.forEach((rank, at) => {
        const row = report.rows[offset + at]
        if (row && rank) report.rows[offset + at] = { ...row, rank }
      })

    const cacheFile = cacheFileOf(root)
    const before = readCache(cacheFile)
    const after: RankCache = {}
    const jobs: Job[] = []

    for (const group of groups) {
      const text = await fs.promises.readFile(path.join(root, group.file), 'utf8').catch(() => null)
      if (text === null) {
        report.done += 1
        continue
      }

      const hash = hashOf(text)
      const keys = keysOf(group.facts)
      const cached = hit(before, group.file, hash, keys)
      if (cached === null) {
        jobs.push({ ...group, text, hash })
        continue
      }

      after[group.file] = { hash, keys, ranks: cached }
      place(group.offset, cached)
      report.done += 1
    }

    publish()
    ready(state.report)

    let missing: DraftFailure | null = null
    const project = path.basename(root)

    const rankJob = async (job: Job) => {
      if (signal.aborted) return
      const ranked = missing
        ? { ranks: [], failure: missing }
        : await rankFile(project, root, job.file, job.facts, job.text, run, signal)
      if (signal.aborted) return

      place(job.offset, ranked.ranks)
      if (ranked.failure?.kind === 'not-installed') missing = ranked.failure
      if (ranked.failure) report.failure = ranked.failure

      const complete = ranked.ranks.flatMap((rank) => (rank ? [rank] : []))
      if (complete.length === job.facts.length)
        after[job.file] = { hash: job.hash, keys: keysOf(job.facts), ranks: complete }
      else report.failed += 1
      report.done += 1
      publish()
    }

    await pooled(jobs, rankJob, LANES)

    try {
      writeCache(cacheFile, signal.aborted ? { ...readCache(cacheFile), ...after } : after)
    } catch (err) {
      console.error('could not persist function ranks:', errorText(err))
    }
  }

  function rank(root: string, map: CodeMap): Promise<FunctionsReport> {
    const known = runs.get(root)
    if (known?.busy) {
      known.again = map
      return Promise.resolve(known.report)
    }

    const blank: FunctionsReport = { root, rows: [], done: 0, total: 0, failed: 0, failure: null }
    const state: Run = known ?? { controller: new AbortController(), report: blank, busy: false, again: null }
    runs.set(root, state)
    state.busy = true

    return new Promise((resolve) => {
      pass(root, map, state, resolve)
        .catch((err: unknown) => {
          state.report = { ...state.report, failure: { kind: 'failed', code: 1, stderr: errorText(err) } }
          if (!state.controller.signal.aborted) emit(state.report)
          resolve(state.report)
        })
        .finally(() => {
          state.busy = false
          const next = state.again
          state.again = null
          if (next && runs.get(root) === state && !state.controller.signal.aborted) void rank(root, next)
        })
    })
  }

  function stop(root: string) {
    runs.get(root)?.controller.abort()
    runs.delete(root)
  }

  return { rank, stop }
}
