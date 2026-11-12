import path from 'node:path'
import picomatch from 'picomatch'
import type { FunctionEntry, LimitRule, RuleEntry, RuleViolation } from '../../shared/types'
import type { SourceFacts } from './facts'

export const DEFAULT_RULES: RuleEntry[] = [
  { rule: 'skip', globs: ['**/*.test.*', '**/*.spec.*'] },
  { rule: 'lines', limit: 200, globs: [] },
  { rule: 'files', limit: 5, globs: [] },
  { rule: 'names', banned: ['Manager', 'Helper', 'Service', 'Factory', 'Base'], globs: [] },
  { rule: 'jobs', limit: 1, globs: [] },
]

const compiled = new Map<string, (path: string) => boolean>()

function matches(glob: string, file: string): boolean {
  let isMatch = compiled.get(glob)
  if (!isMatch) {
    try {
      isMatch = picomatch(glob, { dot: true })
    } catch {
      isMatch = () => false
    }
    compiled.set(glob, isMatch)
  }
  return isMatch(file)
}

function effective(declared: RuleEntry[] | undefined): RuleEntry[] {
  const own = declared ?? []
  const skips = own.some((entry) => entry.rule === 'skip') ? [] : DEFAULT_RULES.filter((entry) => entry.rule === 'skip')
  return [...DEFAULT_RULES.filter((entry) => entry.rule !== 'skip'), ...skips, ...own]
}

function lastFor<R extends RuleEntry['rule']>(entries: RuleEntry[], rule: R, file: string) {
  let found: RuleEntry | undefined
  for (const entry of entries) {
    if (entry.rule === rule && (entry.globs.length === 0 || entry.globs.some((glob) => matches(glob, file)))) found = entry
  }
  return found as Extract<RuleEntry, { rule: R }> | undefined
}

function limitOf(entries: RuleEntry[], rule: LimitRule, file: string): number | 'off' {
  return lastFor(entries, rule, file)?.limit ?? 'off'
}

function bannedWord(name: string, entries: RuleEntry[], file: string): string | undefined {
  const banned = lastFor(entries, 'names', file)?.banned ?? 'off'
  if (banned === 'off') return undefined
  const words = name.split(/[^A-Za-z0-9]+/).flatMap((part) => part.match(/[A-Z]+(?![a-z])\d*|[A-Z]?[a-z]+\d*|\d+/g) ?? [])
  const lower = new Set(words.map((word) => word.toLowerCase()))
  return banned.find((word) => lower.has(word.toLowerCase()))
}

function jobsOf(file: string, functions: FunctionEntry[]): FunctionEntry[][] {
  const parent = functions.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i] as number] as number
    return i
  }
  const join = (a: number, b: number) => {
    parent[find(a)] = find(b)
  }

  functions.forEach((fn, i) => {
    for (const call of fn.calls) if (call.file === file && call.fn >= 0 && call.fn < functions.length) join(i, call.fn)
    functions.forEach((outer, j) => {
      if (j !== i && outer.line <= fn.line && fn.endLine <= outer.endLine) join(i, j)
    })
  })

  const groups = new Map<number, FunctionEntry[]>()
  functions.forEach((fn, i) => {
    if (!fn.exported || fn.name.includes('.')) return
    groups.set(find(i), [...(groups.get(find(i)) ?? []), fn])
  })
  return [...groups.values()].sort((a, b) => (a[0]?.line ?? 0) - (b[0]?.line ?? 0))
}

export function folderOf(file: string): string {
  const dir = path.posix.dirname(file)
  return dir === '.' ? '' : dir
}

function lines(entries: RuleEntry[], file: SourceFacts): RuleViolation[] {
  const limit = limitOf(entries, 'lines', file.path)
  if (limit === 'off' || file.lines <= limit) return []
  return [{ rule: 'lines', path: file.path, line: limit + 1, key: `lines:${file.path}`, amount: file.lines, message: `${file.lines} lines, the limit is ${limit}` }]
}

function names(entries: RuleEntry[], file: SourceFacts): RuleViolation[] {
  const subjects: { kind: string; name: string; line?: number }[] = [
    { kind: 'file', name: path.posix.basename(file.path).replace(/\.[^.]*$/, '') },
    ...file.classes.map((named) => ({ kind: 'class', ...named })),
    ...file.functions.map((fn) => ({ kind: 'function', name: fn.name.split('.').pop() ?? fn.name, line: fn.line })),
  ]

  return subjects.flatMap(({ kind, name, line }) => {
    const word = bannedWord(name, entries, file.path)
    if (word === undefined) return []
    const key = `names:${file.path}:${kind}:${name}`
    return [{ rule: 'names' as const, path: file.path, ...(line === undefined ? {} : { line }), key, amount: 1, message: `${kind} ${name} uses the banned word ${word}` }]
  })
}

function jobs(entries: RuleEntry[], file: SourceFacts): RuleViolation[] {
  const limit = limitOf(entries, 'jobs', file.path)
  if (limit === 'off') return []

  const groups = jobsOf(file.path, file.functions)
  const over = groups[limit]?.[0]
  if (!over) return []

  const listed = groups.map((group) => `${group.map((fn) => fn.name).join(', ')} (line ${group[0]?.line})`).join('; ')
  const message = `${groups.length} unrelated groups of exported functions with no calls between them, the limit is ${limit}: ${listed}`
  return [{ rule: 'jobs', path: file.path, line: over.line, key: `jobs:${file.path}`, amount: groups.length, message }]
}

function files(entries: RuleEntry[], considered: SourceFacts[]): RuleViolation[] {
  const byFolder = new Map<string, SourceFacts[]>()
  for (const file of considered) byFolder.set(folderOf(file.path), [...(byFolder.get(folderOf(file.path)) ?? []), file])

  return [...byFolder].flatMap(([folder, held]) => {
    const shown = folder || '.'
    const limit = limitOf(entries, 'files', shown)
    if (limit === 'off' || held.length <= limit) return []
    const listed = held.map((file) => path.posix.basename(file.path)).sort().join(', ')
    return [{ rule: 'files' as const, path: shown, key: `files:${shown}`, amount: held.length, message: `${held.length} code files, the limit is ${limit}: ${listed}` }]
  })
}

export function auditRules(declared: RuleEntry[] | undefined, sources: SourceFacts[], scope?: string): RuleViolation[] {
  const entries = effective(declared)
  const inScope = (file: string) => !scope || file === scope || file.startsWith(`${scope}/`)
  const considered = sources.filter((file) => inScope(file.path) && !entries.some((entry) => entry.rule === 'skip' && entry.globs.some((glob) => matches(glob, file.path))))
  const found = [...considered.flatMap((file) => [...lines(entries, file), ...names(entries, file), ...jobs(entries, file)]), ...files(entries, considered)]
  return found.sort((a, b) => a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule) || (a.line ?? 0) - (b.line ?? 0))
}
