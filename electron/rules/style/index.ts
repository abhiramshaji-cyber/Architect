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
  const kept = new Set(auditRules(declared, sources, scope).map((violation) => violation.key))
  const found = new Map<string, StyleFile>(paths.map((path) => [path, { path, failing: [] }]))
  const seen = new Set<string>()

  for (const violation of [...auditRules(declared, sources, scope), ...auditRules(strictOf(declared), sources, scope)]) {
    for (const path of filesHit(violation, paths)) {
      const file = found.get(path)
      if (!file || seen.has(`${path}\0${violation.key}`)) continue
      seen.add(`${path}\0${violation.key}`)
      const { rule, message } = violation
      file.failing.push({ rule, ...(violation.line === undefined ? {} : { line: violation.line }), message, grandfathered: !kept.has(violation.key) })
    }
  }
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path))
}

export function styleIn(root: string, map: CodeMap, architecture: Architecture | null): StyleFile[] {
  return styleOf(architecture?.rules, sourcesIn(root, map), architecture?.scope)
}
