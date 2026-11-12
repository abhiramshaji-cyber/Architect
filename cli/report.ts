import type { Architecture, RuleViolation, Verdict } from '../shared/types'

export type Violation = { from: string; to: string; verdict: Verdict; evidence: { from: string; to: string }[] }

function describe(violation: Violation): string {
  if (violation.verdict.status === 'forbidden') return `forbidden: ${violation.verdict.reason}`
  if (violation.verdict.status === 'undrawn-edge') return 'undrawn edge: the drawing has no dependency for it'
  if (violation.verdict.status === 'unknown-component') return `unknown component: ${violation.verdict.ids.join(', ')}`
  if (violation.verdict.status === 'unknown' && violation.verdict.reason) return `unknown: ${violation.verdict.reason}`
  return 'unknown'
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function report(architecture: Architecture, violations: Violation[], broken: RuleViolation[] = []): string {
  const title = architecture.title || 'architect.md'
  if (violations.length === 0 && broken.length === 0) return `architect: ${title} satisfied, no violations`

  const counts = [violations.length > 0 && plural(violations.length, 'violation'), broken.length > 0 && plural(broken.length, 'rule violation')]
  const lines = [`architect: ${counts.filter(Boolean).join(' and ')} against ${title}`, '']

  for (const violation of violations) {
    lines.push(`  ${violation.from} -> ${violation.to}`)
    lines.push(`    ${describe(violation)}`)
    for (const evidence of violation.evidence) lines.push(`    ${evidence.from} calls ${evidence.to}`)
    lines.push('')
  }
  if (violations.length > 0) lines.push('draw the edge in architect.md or remove the dependency from the code')
  if (violations.length > 0 && broken.length > 0) lines.push('')

  for (const rule of broken) lines.push(`  ${rule.rule}  ${rule.path}${rule.line === undefined ? '' : `:${rule.line}`}  ${rule.message}`)
  if (broken.length > 0) lines.push('', 'fix the code, or tune the rule in the Rules section of architect.md')

  return lines.join('\n')
}
