import fs from 'node:fs'
import path from 'node:path'
import { ruleRunSchema, type CheckedRule, type RuleRun, type RuleViolation } from '../../shared/types'
import { cacheKey } from '../scan/cache'

export const RUNS_LIMIT = 1000

const CHECKED: CheckedRule[] = ['lines', 'files', 'names', 'jobs']

function runsPath(dir: string, root: string): string {
  return path.join(dir, 'rules', `${cacheKey(root)}.json`)
}

export function readRuns(dir: string, root: string): RuleRun[] {
  let stored: unknown
  try {
    stored = JSON.parse(fs.readFileSync(runsPath(dir, root), 'utf8'))
  } catch {
    return []
  }
  return Array.isArray(stored) ? stored.flatMap((raw) => ruleRunSchema.safeParse(raw).data ?? []) : []
}

export function recordRuns(
  dir: string,
  root: string,
  source: RuleRun['source'],
  violations: RuleViolation[],
  file?: string,
  at = Date.now(),
): RuleRun[] {
  const runs = CHECKED.map((rule): RuleRun => {
    const count = violations.filter((violation) => violation.rule === rule).length
    return { at, source, rule, pass: count === 0, violations: count, ...(file === undefined ? {} : { file }) }
  })

  const target = runsPath(dir, root)
  const temp = `${target}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(temp, JSON.stringify([...runs, ...readRuns(dir, root)].slice(0, RUNS_LIMIT)))
  fs.renameSync(temp, target)
  return runs
}
