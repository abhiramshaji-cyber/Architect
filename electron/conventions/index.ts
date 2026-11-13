import fs from 'node:fs'
import path from 'node:path'
import { readSettings, saveSettings } from '../../shared/settings'
import type { Architecture, CodeMap, Convention, Conventions, DraftResult } from '../../shared/types'
import { suggestConventions } from '../draft/conventions'
import type { AiRun } from '../draft/draft'
import { effective } from '../rules/audit'
import { type SourceFacts, sourcesIn } from '../rules/facts'
import { ruleLine } from '../rules/syntax'
import { impactOf, withBanned } from './impact'
import { measured } from './measure'
import { promoted, ruleOf } from './promote'

export type Project = { root: string; map: CodeMap; architecture: Architecture | null }

const settingsIn = (dir: string) => path.join(dir, 'settings.json')

const asking = new Map<string, AbortController>()

function on(dir: string): boolean {
  return readSettings(settingsIn(dir)).conventions
}

function ensureOn(dir: string): void {
  if (!on(dir)) throw new Error('learned conventions are off, turn them on first')
}

function weighed(architecture: Architecture | null, sources: SourceFacts[], found: Convention[]): Convention[] {
  const { rules, scope } = architecture ?? {}
  return found.map((convention) => {
    if (convention.rule === undefined) return convention
    const read = ruleOf(convention.rule)
    const entry = typeof read === 'string' ? read : withBanned(rules, read)
    if (typeof entry !== 'string') return { ...convention, rule: ruleLine(entry), impact: impactOf(rules, sources, scope, entry) }

    const { rule, ...rest } = convention
    return { ...rest, unusable: `${rule}: ${entry}` }
  })
}

export async function conventionsOf(dir: string, load: () => Promise<Project>): Promise<Conventions> {
  if (!on(dir)) return { enabled: false }
  const { root, map, architecture } = await load()
  if (!on(dir)) return { enabled: false }
  const sources = sourcesIn(root, map)
  const found = weighed(architecture, sources, measured(architecture, sources))
  return { enabled: true, measured: found.filter((convention) => convention.impact?.loosens.length === 0) }
}

export function switchConventions(dir: string, enabled: boolean, load: () => Promise<Project>): Promise<Conventions> {
  saveSettings(settingsIn(dir), { conventions: enabled })
  if (!enabled) for (const ask of asking.values()) ask.abort()
  return conventionsOf(dir, load)
}

export async function suggestedConventions(dir: string, load: () => Promise<Project>, run: AiRun): Promise<DraftResult<Convention[]>> {
  ensureOn(dir)
  const { root, map, architecture } = await load()
  const sources = sourcesIn(root, map)
  const known = { architecture, rules: effective(architecture?.rules).map(ruleLine), measured: measured(architecture, sources) }

  ensureOn(dir)
  asking.get(root)?.abort()
  const ask = new AbortController()
  asking.set(root, ask)
  const result = await suggestConventions(root, map, known, run, ask.signal).finally(() => {
    if (asking.get(root) === ask) asking.delete(root)
  })
  if (ask.signal.aborted) throw new Error('the request for suggestions was stopped before the AI replied')
  return result.ok ? { ok: true, value: weighed(architecture, sources, result.value) } : result
}

export function promoteConvention(dir: string, root: string, line: string): void {
  ensureOn(dir)
  const file = path.join(root, 'architect.md')
  if (!fs.existsSync(file)) throw new Error('there is no architect.md to add the rule to, create the contract first')
  fs.writeFileSync(file, promoted(fs.readFileSync(file, 'utf8'), line))
}
