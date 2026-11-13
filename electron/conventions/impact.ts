import picomatch from 'picomatch'
import type { ConventionImpact, RuleEntry, RuleViolation } from '../../shared/types'
import { auditRules, effective, folderOf } from '../rules/audit'
import type { SourceFacts } from '../rules/facts'
import { ruleLine } from '../rules/syntax'
import type { Checked } from './promote'

const missingFrom = (found: RuleViolation[], other: RuleViolation[]) => found.filter((violation) => !other.some((old) => old.key === violation.key))

function rootOf(glob: string): string | null {
  const scanned = picomatch.scan(glob)
  return scanned.negated || scanned.base === '' ? null : scanned.base
}

function overlaps(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true
  return a.some((x) =>
    b.some((y) => {
      const [p, q] = [rootOf(x), rootOf(y)]
      return p === null || q === null || p === q || p.startsWith(`${q}/`) || q.startsWith(`${p}/`)
    }),
  )
}

function earlier(declared: RuleEntry[] | undefined, entry: Checked): Checked[] {
  return effective(declared).filter((old): old is Checked => old.rule === entry.rule && overlaps(old.globs, entry.globs))
}

function stricter(old: Checked, entry: Checked): boolean {
  if (old.rule === 'names' && entry.rule === 'names') {
    if (old.banned === 'off') return false
    const kept = entry.banned === 'off' ? new Set<string>() : new Set(entry.banned.map((word) => word.toLowerCase()))
    return old.banned.some((word) => !kept.has(word.toLowerCase()))
  }
  if (old.rule === 'names' || entry.rule === 'names' || old.limit === 'off') return false
  return entry.limit === 'off' || old.limit < entry.limit
}

export function withBanned(declared: RuleEntry[] | undefined, entry: Checked): Checked {
  if (entry.rule !== 'names' || entry.banned === 'off') return entry
  const words = new Map(entry.banned.map((word) => [word.toLowerCase(), word]))
  for (const old of earlier(declared, entry)) if (old.rule === 'names' && old.banned !== 'off') for (const word of old.banned) if (!words.has(word.toLowerCase())) words.set(word.toLowerCase(), word)
  return { ...entry, banned: [...words.values()] }
}

export function impactOf(declared: RuleEntry[] | undefined, sources: SourceFacts[], scope: string | undefined, entry: Checked): ConventionImpact {
  const reached = entry.globs.length === 0 ? () => true : picomatch(entry.globs, { dot: true })
  const touched = sources.filter((file) => reached(file.path) || reached(folderOf(file.path) || '.'))
  const before = auditRules(declared, touched, scope)
  const after = auditRules([...(declared ?? []), entry], touched, scope)
  const loosens = earlier(declared, entry).filter((old) => stricter(old, entry)).map(ruleLine)
  return { flags: missingFrom(after, before), clears: missingFrom(before, after), loosens }
}
