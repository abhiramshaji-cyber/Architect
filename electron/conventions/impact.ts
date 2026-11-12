import picomatch from 'picomatch'
import type { ConventionImpact, RuleEntry, RuleViolation } from '../../shared/types'
import { auditRules, folderOf } from '../rules/audit'
import type { SourceFacts } from '../rules/facts'

const missingFrom = (found: RuleViolation[], other: RuleViolation[]) => found.filter((violation) => !other.some((old) => old.key === violation.key))

export function impactOf(declared: RuleEntry[] | undefined, sources: SourceFacts[], scope: string | undefined, entry: RuleEntry): ConventionImpact {
  const reached = entry.globs.length === 0 ? () => true : picomatch(entry.globs, { dot: true })
  const touched = sources.filter((file) => reached(file.path) || reached(folderOf(file.path) || '.'))
  const before = auditRules(declared, touched, scope)
  const after = auditRules([...(declared ?? []), entry], touched, scope)
  return { flags: missingFrom(after, before), clears: missingFrom(before, after) }
}
