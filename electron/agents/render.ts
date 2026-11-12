import type { Architecture, Component, RuleEntry } from '../../shared/types'
import { effective } from '../rules/audit'
import { ruleLine } from '../rules/syntax'

export const MARKER = '<!-- architect:agents generated from architect.md by `architect agents`; edits are overwritten -->'

export type Placed = { component: string; folder: string; text: string }

export type Unplaced = { component: string; reason: string }

const MAGIC = /[*?[\]{}()!+@]/

function staticDirs(glob: string): string[] {
  const parts = glob.replace(/\\/g, '/').split('/').filter((part) => part !== '' && part !== '.')
  const magic = parts.findIndex((part) => MAGIC.test(part))
  return magic === -1 ? parts.slice(0, -1) : parts.slice(0, magic)
}

function sharedFolder(owns: string[]): string {
  const bases = owns.filter((glob) => !glob.startsWith('!')).map(staticDirs)
  const first = bases[0] ?? []
  const shared: string[] = []
  for (const [i, part] of first.entries()) {
    if (!bases.every((base) => base[i] === part)) break
    shared.push(part)
  }
  return shared.join('/')
}

function touches(glob: string, folder: string): boolean {
  if (glob === '.') return false
  const parts = glob.split('/')
  const magic = parts.findIndex((part) => MAGIC.test(part))
  const base = (magic === -1 ? parts : parts.slice(0, magic)).join('/')
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
    ...rules.map(ruleLine),
    '',
  ].join('\n')
}

export function renderAgents(architecture: Architecture): { placed: Placed[]; unplaced: Unplaced[] } {
  const folders = architecture.components.map((component) => ({ component, folder: sharedFolder(component.owns) }))
  const placed: Placed[] = []
  const unplaced: Unplaced[] = []

  for (const { component, folder } of folders) {
    const others = folders.filter((other) => other.folder === folder && other.component.id !== component.id).map((other) => other.component.id)
    if (component.owns.length === 0) unplaced.push({ component: component.id, reason: 'it owns nothing' })
    else if (folder === '') unplaced.push({ component: component.id, reason: 'its globs share no folder below the project root' })
    else if (others.length > 0) unplaced.push({ component: component.id, reason: `it shares ${folder} with ${others.join(', ')}` })
    else placed.push({ component: component.id, folder, text: textOf(architecture, component, folder) })
  }

  return { placed, unplaced }
}
