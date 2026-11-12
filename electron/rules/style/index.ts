import type { Architecture, CodeMap, RuleEntry, RuleViolation, StyleFile } from '../../../shared/types'
import { auditRules, consideredOf, effective, folderOf } from '../audit'
import { type SourceFacts, sourcesIn } from '../facts'

function strictOf(declared: RuleEntry[] | undefined): RuleEntry[] {
  return (declared ?? []).filter((entry) => entry.rule === 'skip' || entry.globs.length === 0)
}

function filesHit(violation: RuleViolation, paths: string[]): string[] {
  if (violation.rule !== 'files') return [violation.path]
  const folder = violation.path === '.' ? '' : violation.path
  return paths.filter((file) => folderOf(file) === folder)
}

export function styleOf(declared: RuleEntry[] | undefined, sources: SourceFacts[], scope?: string): StyleFile[] {
  const paths = consideredOf(effective(declared), sources, scope).map((file) => file.path)
  const declaredRun = auditRules(declared, sources, scope)
  const kept = new Set(declaredRun.map((violation) => violation.key))
  const drift = auditRules(strictOf(declared), sources, scope).filter((violation) => !kept.has(violation.key))
  const found = new Map<string, StyleFile>(paths.map((path) => [path, { path, failing: [] }]))

  for (const [violation, grandfathered] of [
    ...declaredRun.map((v) => [v, false] as const),
    ...drift.map((v) => [v, true] as const),
  ]) {
    for (const path of filesHit(violation, paths)) {
      const { rule, message } = violation
      found
        .get(path)
        ?.failing.push({
          rule,
          ...(violation.line === undefined ? {} : { line: violation.line }),
          message,
          grandfathered,
        })
    }
  }
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path))
}

export function styleIn(root: string, map: CodeMap, architecture: Architecture | null): StyleFile[] {
  return styleOf(architecture?.rules, sourcesIn(root, map), architecture?.scope)
}
