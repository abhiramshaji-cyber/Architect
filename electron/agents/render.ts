import picomatch from 'picomatch'
import type { Architecture, Component, RuleEntry } from '../../shared/types'
import { IGNORED_DIRS } from '../scan/scan'
import { effective } from '../rules/audit'
import { ruleLine } from '../rules/syntax'

export const MARKER = '<!-- architect:agents generated from architect.md by `architect agents`; edits are overwritten -->'

export type Placed = { component: string; folder: string; text: string }

export type Unplaced = { component: string; reason: string }

function globRoot(glob: string): { dirs: string[]; rest: string } {
  const scanned = picomatch.scan(glob.replace(/\\/g, '/'))
  const parts = scanned.base.split('/').filter((part) => part !== '' && part !== '.')
  return { dirs: scanned.isGlob ? parts : parts.slice(0, -1), rest: scanned.glob }
}

function placeOf(component: Component): { folder: string } | { reason: string } {
  const globs = component.owns.filter((glob) => !glob.startsWith('!'))
  if (globs.length === 0) return { reason: 'it owns nothing' }

  const bases = globs.map(globRoot)
  if (bases.some((base) => base.dirs.includes('..'))) return { reason: 'its globs climb out with .., so its folder is not certain' }

  const first = bases[0]?.dirs ?? []
  const shared = first.slice(0, [...first, ''].findIndex((part, i) => !bases.every((base) => base.dirs[i] === part)))
  const folder = shared.join('/')
  if (folder === '') return { reason: 'its globs share no folder below the project root' }
  if (shared.some((part) => IGNORED_DIRS.has(part) || part.startsWith('.'))) return { reason: `${folder} is a folder Architect does not scan` }
  const whole = bases.some((base) => base.dirs.join('/') === folder && base.rest === '**')
  const carved = component.owns.some((glob) => glob.startsWith('!') && `${globRoot(glob.slice(1)).dirs.join('/')}/`.startsWith(`${folder}/`))
  if (!whole || carved) return { reason: `it owns files in ${folder} but not the whole folder` }
  return { folder }
}

function touches(glob: string, folder: string): boolean {
  if (glob === '.') return false
  const base = picomatch.scan(glob).base
  return base === '' || base === folder || base.startsWith(`${folder}/`) || folder.startsWith(`${base}/`)
}

function rulesIn(declared: RuleEntry[] | undefined, folder: string): RuleEntry[] {
  const all = effective(declared)
  const key = (entry: RuleEntry) => `${entry.rule} ${entry.globs.join(',')}`
  return all.flatMap((entry, i) => {
    if (all.slice(i + 1).some((later) => key(later) === key(entry))) return []
    if (entry.globs.length === 0) return [entry]
    const globs = entry.globs.filter((glob) => touches(glob, folder))
    return globs.length > 0 ? [{ ...entry, globs }] : []
  })
}

function listed(lines: string[]): string[] {
  return lines.length > 0 ? lines : ['- none']
}

function textOf(architecture: Architecture, component: Component, folder: string): string {
  const calls = architecture.edges.filter((edge) => edge.from === component.id)
  const never = architecture.forbidden.filter((rule) => rule.from === component.id)
  const rules = rulesIn(architecture.rules, folder)

  return [
    MARKER,
    `# ${component.id}`,
    '',
    component.purpose,
    '',
    '## Owns',
    '',
    ...component.owns.map((glob) => `- \`${glob}\``),
    ...(component.covers ?? []).map((covered) => `- covers \`${covered}\``),
    '',
    '## May call',
    '',
    ...listed(calls.map((edge) => `- ${edge.to}${edge.label ? `: ${edge.label}` : ''}`)),
    '',
    '## Must never call',
    '',
    ...listed(never.map((rule) => `- ${rule.to}: ${rule.reason}`)),
    '',
    '## Rules',
    '',
    'A later line whose globs match a path overrides an earlier one.',
    '',
    ...rules.map(ruleLine),
    '',
  ].join('\n')
}

export function renderAgents(architecture: Architecture): { placed: Placed[]; unplaced: Unplaced[] } {
  const places = architecture.components.map((component) => ({ component, place: placeOf(component) }))
  const placed: Placed[] = []
  const unplaced: Unplaced[] = []

  for (const { component, place } of places) {
    if ('reason' in place) {
      unplaced.push({ component: component.id, reason: place.reason })
      continue
    }
    const others = places.filter((other) => other.component !== component && 'folder' in other.place && other.place.folder === place.folder)
    if (others.length > 0) unplaced.push({ component: component.id, reason: `it shares ${place.folder} with ${others.map((other) => other.component.id).join(', ')}` })
    else placed.push({ component: component.id, folder: place.folder, text: textOf(architecture, component, place.folder) })
  }

  return { placed, unplaced }
}
