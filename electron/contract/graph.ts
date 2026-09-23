import picomatch from 'picomatch'

import { findCycle } from '../../shared/cycle'
import { isPt, type Architecture, type Component, type Edge, type Forbidden, type Layout, type Ownership, type Proposal, type Pt, type Verdict } from '../../shared/types'

const LAYOUT_OPEN = '<!-- architect:layout'
const LAYOUT_CLOSE = '-->'

export type Problem = { message: string; line: number; col: number; end: number }

export type Ref = { id: string; line: number; col: number; definition: boolean }

export type Scan = { architecture: Architecture; problems: Problem[]; refs: Ref[] }

const HEADING = /^###(?:\s+(.*))?$/
const OWNS = /^(owns:\s*)`([^`]+)`\s*$/
const EDGE = /^(-\s*)(\S+)(\s*->\s*)(\S+)\s*$/
const FORBIDDEN = /^(-\s*)(\S+)(\s*->\s*)(\S+)\s*:\s*(.+)$/
const PACKAGE = /^-\s*(.+)$/

type Line = { text: string; line: number; col: number }

function sectionLines(markdown: string, heading: string): Line[] {
  const all = markdown.split(/\r?\n/)
  const start = all.findIndex((l) => l.startsWith(`## ${heading}`))
  if (start === -1) return []

  const found: Line[] = []
  for (let i = start + 1; i < all.length; i++) {
    const raw = all[i] ?? ''
    if (raw.startsWith('## ') || raw.startsWith('<!--')) break
    const text = raw.trim()
    if (text.length === 0 || text.startsWith('<!--')) continue
    found.push({ text, line: i + 1, col: raw.indexOf(text) })
  }
  return found
}

export function sectionAt(markdown: string, line: number): string | undefined {
  const all = markdown.split(/\r?\n/)
  for (let i = Math.min(line, all.length - 1); i >= 0; i--) {
    const raw = all[i] ?? ''
    if (raw.startsWith('## ')) return raw.slice(3).trim()
  }
  return undefined
}

function layoutHint(markdown: string, known: Set<string>, refs: Ref[]): Layout | undefined {
  const start = markdown.lastIndexOf(LAYOUT_OPEN)
  if (start === -1) return undefined

  const from = start + LAYOUT_OPEN.length
  const end = markdown.indexOf(LAYOUT_CLOSE, from)
  const body = end === -1 ? markdown.slice(from) : markdown.slice(from, end)
  const opened = markdown.slice(0, start).split(/\r?\n/).length - 1

  const found = new Map<string, Pt>()
  for (const [offset, raw] of body.split(/\r?\n/).entries()) {
    const colon = raw.indexOf(':')
    if (colon === -1) continue

    const id = raw.slice(0, colon).trim()
    if (!known.has(id) || found.has(id)) continue
    if (offset > 0) refs.push({ id, line: opened + offset, col: raw.indexOf(id), definition: false })

    const coords = raw.slice(colon + 1).split(',')
    if (coords.length !== 2) continue

    const [x, y] = coords.map((c) => (c.trim() === '' ? NaN : Number(c)))
    const pt = { x: x as number, y: y as number }
    if (isPt(pt)) found.set(id, pt)
  }

  return found.size === 0 ? undefined : Object.fromEntries(found)
}

export function scan(markdown: string): Scan {
  const problems: Problem[] = []
  const refs: Ref[] = []
  const note = (message: string, line: number, col: number, end: number) =>
    problems.push({ message, line: line - 1, col, end })

  // title
  const titleMatch = markdown.match(/^# (.+)$/m)
  const title = titleMatch?.[1]?.trim() ?? ''

  // summary
  const afterTitle = titleMatch ? markdown.slice(markdown.indexOf(titleMatch[0]) + titleMatch[0].length) : markdown
  const summaryMatch = afterTitle.match(/^\s*\n+(.+)$/m)
  const summary = summaryMatch?.[1]?.trim() ?? ''

  // components
  const components: Component[] = []
  const seenIds = new Set<string>()
  let stale = false

  for (const { text, line, col } of sectionLines(markdown, 'Components')) {
    const heading = text.match(HEADING)

    if (heading) {
      stale = true
      const body = heading[1] ?? ''
      const id = body.trim()
      const idCol = col + text.length - body.length + body.indexOf(id)

      if (id.length === 0) {
        note('component id cannot be empty', line, col, col + text.length)
        continue
      }
      if (/\s/.test(id) || id.includes('->')) {
        note(`invalid component id "${id}": ids must be one word with no spaces and no "->"`, line, idCol, idCol + id.length)
        continue
      }
      if (seenIds.has(id)) {
        note(`duplicate component: ${id}`, line, idCol, idCol + id.length)
        continue
      }

      stale = false
      seenIds.add(id)
      refs.push({ id, line: line - 1, col: idCol, definition: true })
      components.push({ id, purpose: '', owns: [] })
      continue
    }

    const current = components[components.length - 1]
    if (stale || !current) continue

    if (text.startsWith('owns:')) {
      const m = text.match(OWNS)
      if (!m) {
        note(`malformed owns entry on line ${line}: ${text}`, line, col, col + text.length)
        continue
      }
      current.owns.push(m[2] ?? '')
    }
    else if (current.purpose.length === 0) current.purpose = text
  }

  const knownIds = new Set(components.map((c) => c.id))

  const endpoints = (line: number, col: number, m: RegExpMatchArray, kind: string) => {
    const from = m[2] ?? ''
    const to = m[4] ?? ''
    const fromCol = col + (m[1] ?? '').length
    const toCol = fromCol + from.length + (m[3] ?? '').length

    refs.push({ id: from, line: line - 1, col: fromCol, definition: false })
    refs.push({ id: to, line: line - 1, col: toCol, definition: false })

    if (!knownIds.has(from)) note(`unknown component in ${kind}: ${from}`, line, fromCol, fromCol + from.length)
    if (!knownIds.has(to)) note(`unknown component in ${kind}: ${to}`, line, toCol, toCol + to.length)

    return knownIds.has(from) && knownIds.has(to) ? { from, to } : undefined
  }

  // dependencies
  const edges: Edge[] = []
  for (const { text, line, col } of sectionLines(markdown, 'Dependencies')) {
    const m = text.match(EDGE)
    if (!m) {
      note(`malformed dependency on line ${line}: ${text}`, line, col, col + text.length)
      continue
    }
    const pair = endpoints(line, col, m, 'dependency')
    if (pair) edges.push(pair)
  }

  // forbidden
  const forbidden: Forbidden[] = []
  for (const { text, line, col } of sectionLines(markdown, 'Forbidden')) {
    const m = text.match(FORBIDDEN)
    if (!m) {
      note(`malformed forbidden entry on line ${line}: ${text}`, line, col, col + text.length)
      continue
    }
    const pair = endpoints(line, col, m, 'forbidden')
    if (pair) forbidden.push({ ...pair, reason: (m[5] ?? '').trim() })
  }

  // packages
  const packages: string[] = []
  for (const { text } of sectionLines(markdown, 'Packages')) {
    const m = text.match(PACKAGE)
    if (m) packages.push((m[1] ?? '').trim())
  }

  const layout = layoutHint(markdown, knownIds, refs)

  return {
    architecture: { title, summary, components, edges, forbidden, packages, ...(layout && { layout }) },
    problems,
    refs,
  }
}

export function parse(markdown: string): Architecture {
  const { architecture, problems } = scan(markdown)
  const first = problems[0]
  if (first) throw new Error(first.message)
  return architecture
}

export function serialize(architecture: Architecture): string {
  const lines: string[] = []
  lines.push(`# ${architecture.title}`, '', architecture.summary, '', '## Components', '')

  for (const c of architecture.components) {
    lines.push(`### ${c.id}`, c.purpose, ...c.owns.map((g) => `owns: \`${g}\``), '')
  }

  lines.push('## Dependencies', '')
  for (const e of architecture.edges) lines.push(`- ${e.from} -> ${e.to}`)
  lines.push('', '## Forbidden', '')
  for (const f of architecture.forbidden) lines.push(`- ${f.from} -> ${f.to} : ${f.reason}`)
  lines.push('', '## Packages', '')
  for (const p of architecture.packages) lines.push(`- ${p}`)

  const placed = architecture.components
    .map((c) => [c.id, architecture.layout?.[c.id]] as const)
    .filter((entry): entry is readonly [string, Pt] => isPt(entry[1]))

  if (placed.length > 0) {
    lines.push('', LAYOUT_OPEN)
    for (const [id, pt] of placed) lines.push(`${id}: ${pt.x},${pt.y}`)
    lines.push(LAYOUT_CLOSE)
  }

  return lines.join('\n')
}

export function check(architecture: Architecture, from: string, to: string): Verdict {
  const forbidden = architecture.forbidden.find((f) => f.from === from && f.to === to)
  if (forbidden) return { status: 'forbidden', reason: forbidden.reason }

  const allowed = architecture.edges.some((e) => e.from === from && e.to === to)
  if (allowed) return { status: 'allowed' }

  // missing
  const knownIds = new Set(architecture.components.map((c) => c.id))
  const missing = [...new Set([from, to].filter((id) => !knownIds.has(id)))]
  if (missing.length > 0) return { status: 'unknown-component', ids: missing }

  const cycle = findCycle(architecture.edges, from, to)
  if (cycle) return { status: 'cycle', path: cycle }

  return { status: 'undrawn-edge' }
}

export function apply(architecture: Architecture, proposal: Proposal): Architecture {
  const next: Architecture = {
    title: architecture.title,
    summary: architecture.summary,
    components: [...architecture.components],
    edges: [...architecture.edges],
    forbidden: [...architecture.forbidden],
    packages: [...architecture.packages],
    layout: architecture.layout,
  }

  if (proposal.kind === 'contract') {
    throw new Error('a contract proposal replaces architect.md, it is not applied to an architecture')
  }

  if (proposal.kind === 'component') {
    if (next.components.some((c) => c.id === proposal.id)) return next
    next.components.push({ id: proposal.id, purpose: proposal.purpose, owns: proposal.owns })
    return next
  }

  if (proposal.kind === 'remove_component') {
    if (!next.components.some((c) => c.id === proposal.id)) {
      throw new Error(`unknown component in remove proposal: ${proposal.id}`)
    }
    next.components = next.components.filter((c) => c.id !== proposal.id)
    next.edges = next.edges.filter((e) => e.from !== proposal.id && e.to !== proposal.id)
    next.forbidden = next.forbidden.filter((f) => f.from !== proposal.id && f.to !== proposal.id)
    return next
  }

  if (proposal.kind === 'edge') {
    if (next.edges.some((e) => e.from === proposal.from && e.to === proposal.to)) return next
    const cycle = findCycle(next.edges, proposal.from, proposal.to)
    if (cycle) throw new Error(`edge ${proposal.from} -> ${proposal.to} would introduce a cycle: ${cycle.join(' -> ')}`)
    next.edges.push({ from: proposal.from, to: proposal.to })
    return next
  }

  if (proposal.kind === 'package') {
    if (!next.components.some((c) => c.id === proposal.component)) {
      throw new Error(`unknown component in package proposal: ${proposal.component}`)
    }
    if (next.packages.includes(proposal.name)) return next
    next.packages.push(proposal.name)
    return next
  }

  if (proposal.kind === 'file') {
    const target = next.components.find((c) => c.id === proposal.component)
    if (!target) throw new Error(`unknown component in file proposal: ${proposal.component}`)
    if (target.owns.includes(proposal.path)) return next
    next.components = next.components.map((c) =>
      c.id === proposal.component ? { ...c, owns: [...c.owns, proposal.path] } : c,
    )
    return next
  }

  return next
}

function canonical(raw: string): string {
  const parts: string[] = []

  for (const part of raw.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') {
      parts.push(part)
      continue
    }
    if (parts.length === 0 || parts[parts.length - 1] === '..') parts.push('..')
    else parts.pop()
  }

  return parts.join('/')
}

function canonicalPattern(raw: string): string {
  const negated = raw.startsWith('!')
  const body = canonical(negated ? raw.slice(1) : raw)
  if (body === '') return ''
  return negated ? `!${body}` : body
}

function hits(pattern: string, paths: string[]): string[] {
  if (pattern === '') return []
  try {
    const isMatch = picomatch(pattern, { dot: true, nocase: false })
    // picomatch-returnobject-arg2
    return paths.filter((path) => isMatch(path))
  } catch {
    return []
  }
}

export function ownership(files: string[], components: Component[]): Ownership {
  const paths = [...new Set(files.map(canonical))].filter((p) => p !== '').sort()
  const owners = new Map(paths.map((p) => [p, new Set<string>()]))
  const dead: Ownership['dead'] = []

  for (const component of components) {
    const seen = new Set<string>()

    for (const raw of component.owns) {
      const pattern = canonicalPattern(raw)
      if (seen.has(pattern)) continue
      seen.add(pattern)

      const matched = hits(pattern, paths)
      for (const p of matched) owners.get(p)?.add(component.id)
      if (matched.length === 0) dead.push({ component: component.id, pattern: raw })
    }
  }

  const owned: Ownership['owned'] = []
  const unowned: string[] = []
  const multi: Ownership['multi'] = []

  for (const path of paths) {
    const claimed = [...(owners.get(path) ?? [])].sort()
    if (claimed.length === 0) unowned.push(path)
    else if (claimed.length === 1) owned.push({ path, owner: claimed[0] as string })
    else multi.push({ path, owners: claimed })
  }

  return { owned, unowned, multi, dead }
}
