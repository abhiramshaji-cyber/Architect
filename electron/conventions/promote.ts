import type { RuleEntry } from '../../shared/types'
import { parseRules, ruleLine } from '../rules/syntax'

const ends = (row: string) => row.startsWith('## ') || row.startsWith('<!--')

export function ruleOf(line: string): RuleEntry | string {
  let problem = 'not a rule line'
  const [entry] = parseRules([{ text: line.trim(), line: 1, col: 0 }], (message) => {
    problem = message
  })
  if (!entry) return problem
  if (entry.rule === 'skip' || entry.rule === 'split') return `a ${entry.rule} rule checks nothing, only lines, files, names and jobs rules can be added`
  return entry
}

export function promoted(markdown: string, line: string): string {
  const entry = ruleOf(line)
  if (typeof entry === 'string') throw new Error(entry)

  const text = ruleLine(entry)
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  const lines = markdown.split(eol)
  const at = lines.findIndex((row) => row.trimEnd() === '## Rules')
  if (at === -1) return `${markdown.trimEnd()}${eol}${eol}## Rules${eol}${eol}${text}${eol}`

  const next = lines.findIndex((row, i) => i > at && ends(row))
  let end = next === -1 ? lines.length : next
  while (end > at + 1 && lines[end - 1]?.trim() === '') end--
  if (lines.slice(at + 1, end).some((row) => row.trim() === text)) throw new Error(`${text} is already a rule`)

  lines.splice(end, 0, text)
  return lines.join(eol)
}
