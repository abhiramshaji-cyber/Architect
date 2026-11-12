import type { RuleEntry } from '../../shared/types'

type Line = { text: string; line: number; col: number }

type Note = (message: string, line: number, col: number, end: number) => void

const ENTRY = /^-\s*([A-Za-z]+)\s*:\s*(.*)$/

const GLOB = /`([^`]*)`/g

const WORD = /^[A-Za-z][A-Za-z0-9]*$/

const THRESHOLD = /^(\d+)\s+lines?\s*,\s*(\d+)\s+callers?$/

function parseValue(rule: string, value: string, globs: string[]): RuleEntry | string {
  if (rule === 'skip') {
    if (value === 'off' && globs.length === 0) return { rule, globs: [] }
    if (value === '' && globs.length > 0) return { rule, globs }
    return 'skip takes backticked globs, or off'
  }

  if (rule === 'names') {
    if (value === 'off') return { rule, banned: 'off', globs }
    const banned = value.split(',').map((word) => word.trim())
    if (value !== '' && banned.every((word) => WORD.test(word))) return { rule, banned, globs }
    return 'names takes a comma separated list of words, or off'
  }

  if (rule === 'lines' || rule === 'files' || rule === 'jobs') {
    if (value === 'off') return { rule, limit: 'off', globs }
    const limit = Number(value)
    if (/^\d+$/.test(value) && Number.isSafeInteger(limit) && limit > 0) return { rule, limit, globs }
    return `${rule} takes a whole number above zero, or off`
  }

  if (rule === 'split') {
    if (value === 'off') return { rule, threshold: 'off', globs }
    const [, lines, callers] = value.match(THRESHOLD) ?? []
    const threshold = { lines: Number(lines), callers: Number(callers) }
    if (Number.isSafeInteger(threshold.lines) && Number.isSafeInteger(threshold.callers) && threshold.lines > 0 && threshold.callers > 0) return { rule, threshold, globs }
    return 'split takes "<n> lines, <n> callers" with both above zero, or off'
  }

  return `unknown rule "${rule}": use skip, lines, files, names, jobs or split`
}

export function parseRules(lines: Line[], note: Note): RuleEntry[] {
  const entries: RuleEntry[] = []

  for (const { text, line, col } of lines) {
    const m = text.match(ENTRY)
    if (!m) {
      note(`malformed rule on line ${line}: ${text}`, line, col, col + text.length)
      continue
    }

    const rest = m[2] ?? ''
    const globs = [...rest.matchAll(GLOB)].map((g) => (g[1] ?? '').trim())
    const value = rest.replace(GLOB, '').replace(/[\s,]+$/, '').trim()
    if (globs.some((glob) => glob === '')) {
      note(`empty glob in rule on line ${line}`, line, col, col + text.length)
      continue
    }

    const parsed = parseValue(m[1] ?? '', value, globs)
    if (typeof parsed === 'string') note(`${parsed} (line ${line})`, line, col, col + text.length)
    else entries.push(parsed)
  }

  return entries
}

function valueOf(entry: Exclude<RuleEntry, { rule: 'skip' }>): string {
  if (entry.rule === 'names') return entry.banned === 'off' ? 'off' : entry.banned.join(', ')
  if (entry.rule === 'split') return entry.threshold === 'off' ? 'off' : `${entry.threshold.lines} lines, ${entry.threshold.callers} callers`
  return String(entry.limit)
}

export function ruleLine(entry: RuleEntry): string {
  const globs = entry.globs.map((glob) => `\`${glob}\``).join(', ')
  if (entry.rule === 'skip') return `- skip: ${globs || 'off'}`
  const value = valueOf(entry)
  return `- ${entry.rule}: ${value}${globs ? ` ${globs}` : ''}`
}
