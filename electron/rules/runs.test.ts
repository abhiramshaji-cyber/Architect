import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RuleViolation } from '../../shared/types'
import { readRuns, recordRuns, RUNS_LIMIT } from './runs'

const dirs: string[] = []

function temp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-runs-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length > 0) fs.rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const broken: RuleViolation = { rule: 'lines', path: 'a.ts', line: 201, key: 'lines:a.ts', amount: 250, message: '250 lines' }

describe('rule runs', () => {
  it('stores one pass or fail run per rule and reads it back newest first', () => {
    const cache = temp()
    const root = temp()
    recordRuns(cache, root, 'check', [], undefined, 1)
    recordRuns(cache, root, 'check_change', [broken, broken], 'a.ts', 2)

    const runs = readRuns(cache, root)
    expect(runs).toHaveLength(8)
    expect(runs[0]).toEqual({ at: 2, source: 'check_change', rule: 'lines', pass: false, violations: 2, file: 'a.ts' })
    expect(runs.filter((run) => run.at === 1).every((run) => run.pass && run.source === 'check' && run.file === undefined)).toBe(true)
  })

  it('keeps the newest runs once the cap is reached', () => {
    const cache = temp()
    const root = temp()
    for (let at = 0; at < RUNS_LIMIT / 4 + 3; at++) recordRuns(cache, root, 'check', [], undefined, at)

    const runs = readRuns(cache, root)
    expect(runs).toHaveLength(RUNS_LIMIT)
    expect(Math.min(...runs.map((run) => run.at))).toBe(3)
  })

  it('reads nothing for a project never checked and drops rows that do not fit the schema', () => {
    const cache = temp()
    const root = temp()
    expect(readRuns(cache, root)).toEqual([])

    recordRuns(cache, root, 'check', [], undefined, 5)
    const file = path.join(cache, 'rules', fs.readdirSync(path.join(cache, 'rules'))[0] as string)
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.writeFileSync(file, JSON.stringify([...rows, { at: 'soon' }, null, 7]))
    expect(readRuns(cache, root)).toHaveLength(4)

    fs.writeFileSync(file, '{not json')
    expect(readRuns(cache, root)).toEqual([])
  })
})
