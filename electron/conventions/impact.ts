import type { ConventionImpact, RuleEntry, RuleViolation } from '../../shared/types'
import { auditRules } from '../rules/audit'
import type { SourceFacts } from '../rules/facts'

const missingFrom = (found: RuleViolation[], other: RuleViolation[]) => found.filter((violation) => !other.some((old) => old.key === violation.key))

export function impactOf(before: RuleViolation[], declared: RuleEntry[] | undefined, sources: SourceFacts[], scope: string | undefined, entry: RuleEntry): ConventionImpact {
  const after = auditRules([...(declared ?? []), entry], sources, scope)
  return { flags: missingFrom(after, before), clears: missingFrom(before, after) }
}
