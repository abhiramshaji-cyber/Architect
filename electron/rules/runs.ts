import path from 'node:path'
import { ruleRunSchema, type CheckedRule, type RuleRun, type RuleViolation } from '../../shared/types'
import { createJournal } from '../journal'
import { cacheKey } from '../scan/cache'

export const RUNS_LIMIT = 200

const CHECKED: CheckedRule[] = ['lines', 'files', 'names', 'jobs']

function journalIn(dir: string) {
  return createJournal((root) => path.join(dir, 'rules', `${cacheKey(root)}.json`), ruleRunSchema, RUNS_LIMIT)
}

export function readRuns(dir: string, root: string): RuleRun[] {
  return journalIn(dir).list(root)
}

export function recordRuns(
  dir: string,
  root: string,
  source: RuleRun['source'],
  violations: RuleViolation[],
  file?: string,
  at = Date.now(),
): RuleRun {
  const results = CHECKED.map((rule) => {
    const count = violations.filter((violation) => violation.rule === rule).length
    return { rule, pass: count === 0, violations: count }
  })
  const run: RuleRun = { at, source, ...(file === undefined ? {} : { file }), results }
  journalIn(dir).append(root, run)
  return run
}
