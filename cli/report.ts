import type { Architecture, FileSplit, FunctionSplit, RuleViolation, SplitSuggestion, Verdict } from '../shared/types'

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

function overText(over: NonNullable<FileSplit['over']['lines']>, word: string): string {
  return `${plural(over.count, word)}, limit ${over.limit}${over.project === undefined ? '' : ` here and ${over.project} project wide`}`
}

function fileLines(split: FileSplit): string[] {
  const over = [split.over.lines && overText(split.over.lines, 'line'), split.over.jobs && overText(split.over.jobs, 'job group')]
  const head = [`  ${split.path}  ${over.filter(Boolean).join('; ')}`]
  if (split.blocked) return [...head, `    no split: ${split.blocked}`]

  const limit = split.files.limit === 'off' ? '' : ` of ${split.files.limit}`
  const groups = split.groups.flatMap((group) => [
    `    ${group.file ?? `unnamed: ${group.unnamed}`}  ${plural(group.lines, 'line')}`,
    `      ${group.members.map((member) => `${member.name}:${member.line}`).join(', ')}`,
  ])
  const stays = split.stays.functions.length > 0 ? `, ${split.stays.functions.join(', ')}` : ''
  return [...head, `    into ${split.folder}/ behind ${split.entry}, ${split.files.count}${limit} code files there`, ...groups, `    stays in the entry: ${plural(split.stays.lines, 'line')}${stays}`]
}

function functionLines(split: FunctionSplit): string[] {
  const head = `  ${split.path}:${split.line}  ${split.name}  ${plural(split.lines, 'line')}, ${plural(split.callers, 'caller')}, over ${split.threshold.lines} lines with ${split.threshold.callers} or more callers`
  if (split.blocked) return [head, `    flagged only: ${split.blocked}`]
  return [head, ...split.points.map((point) => `    extract ${point.label}  ${point.line}-${point.endLine}, ${plural(point.lines, 'line')}`)]
}

function suggestionLines(splits: SplitSuggestion[]): string[] {
  if (splits.length === 0) return ['', 'no split suggestions']
  return ['', `${plural(splits.length, 'split suggestion')}`, '', ...splits.flatMap((split) => [...(split.kind === 'file' ? fileLines(split) : functionLines(split)), ''])]
}

export function report(architecture: Architecture, violations: Violation[], broken: RuleViolation[] = [], splits?: SplitSuggestion[]): string {
  const title = architecture.title || 'architect.md'
  const suggested = splits ? suggestionLines(splits) : []
  if (violations.length === 0 && broken.length === 0) return [`architect: ${title} satisfied, no violations`, ...suggested].join('\n').trimEnd()

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

  return [...lines, ...suggested].join('\n').trimEnd()
}
