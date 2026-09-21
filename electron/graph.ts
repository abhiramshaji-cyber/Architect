import { isPt, type Architecture, type Component, type Edge, type Forbidden, type Layout, type Proposal, type Pt, type Verdict } from '../shared/types'

const LAYOUT_OPEN = '<!-- architect:layout'
const LAYOUT_CLOSE = '-->'

function sectionLines(markdown: string, heading: string): { text: string; line: number }[] {
  const all = markdown.split(/\r?\n/)
  const start = all.findIndex((l) => l.startsWith(`## ${heading}`))
  if (start === -1) return []

  const found: { text: string; line: number }[] = []
  for (let i = start + 1; i < all.length; i++) {
    const raw = all[i] ?? ''
    if (raw.startsWith('## ') || raw.startsWith('<!--')) break
    const text = raw.trim()
    if (text.length === 0 || text.startsWith('<!--')) continue
    found.push({ text, line: i + 1 })
  }
  return found
}

function layoutHint(markdown: string, known: Set<string>): Layout | undefined {
  const start = markdown.lastIndexOf(LAYOUT_OPEN)
  if (start === -1) return undefined

  const from = start + LAYOUT_OPEN.length
  const end = markdown.indexOf(LAYOUT_CLOSE, from)
  const body = end === -1 ? markdown.slice(from) : markdown.slice(from, end)

  const found = new Map<string, Pt>()
  for (const raw of body.split(/\r?\n/)) {
    const colon = raw.indexOf(':')
    if (colon === -1) continue

    const id = raw.slice(0, colon).trim()
    if (!known.has(id) || found.has(id)) continue

    const coords = raw.slice(colon + 1).split(',')
    if (coords.length !== 2) continue

    const [x, y] = coords.map((c) => (c.trim() === '' ? NaN : Number(c)))
    const pt = { x: x as number, y: y as number }
    if (isPt(pt)) found.set(id, pt)
  }

  return found.size === 0 ? undefined : Object.fromEntries(found)
}

export function parse(markdown: string): Architecture {
  const titleMatch = markdown.match(/^# (.+)$/m)
  const title = titleMatch?.[1]?.trim() ?? ''

  const afterTitle = titleMatch ? markdown.slice(markdown.indexOf(titleMatch[0]) + titleMatch[0].length) : markdown
  const summaryMatch = afterTitle.match(/^\s*\n+(.+)$/m)
  const summary = summaryMatch?.[1]?.trim() ?? ''

  // components
  const components: Component[] = []
  const seenIds = new Set<string>()

  for (const { text } of sectionLines(markdown, 'Components')) {
    if (text === '###' || text.startsWith('### ')) {
      const id = text.slice(3).trim()
      if (id.length === 0) throw new Error('component id cannot be empty')
      if (/\s/.test(id) || id.includes('->')) {
        throw new Error(`invalid component id "${id}": ids must be one word with no spaces and no "->"`)
      }
      if (seenIds.has(id)) throw new Error(`duplicate component: ${id}`)
      seenIds.add(id)
      components.push({ id, purpose: '', owns: [] })
      continue
    }

    const current = components[components.length - 1]
    if (!current) continue
    if (text.startsWith('owns:')) current.owns.push(text.match(/`([^`]*)`/)?.[1] ?? '')
    else if (current.purpose.length === 0) current.purpose = text
  }

  const knownIds = new Set(components.map((c) => c.id))

  // dependencies
  const edges: Edge[] = []
  for (const { text, line } of sectionLines(markdown, 'Dependencies')) {
    const m = text.match(/^-\s*(\S+)\s*->\s*(\S+)$/)
    if (!m) throw new Error(`malformed dependency on line ${line}: ${text}`)
    const from = m[1] ?? ''
    const to = m[2] ?? ''
    if (!knownIds.has(from)) throw new Error(`unknown component in dependency: ${from}`)
    if (!knownIds.has(to)) throw new Error(`unknown component in dependency: ${to}`)
    edges.push({ from, to })
  }

  // forbidden
  const forbidden: Forbidden[] = []
  for (const { text, line } of sectionLines(markdown, 'Forbidden')) {
    const m = text.match(/^-\s*(\S+)\s*->\s*(\S+)\s*:\s*(.+)$/)
    if (!m) throw new Error(`malformed forbidden entry on line ${line}: ${text}`)
    const from = m[1] ?? ''
    const to = m[2] ?? ''
    const reason = m[3] ?? ''
    if (!knownIds.has(from)) throw new Error(`unknown component in forbidden: ${from}`)
    if (!knownIds.has(to)) throw new Error(`unknown component in forbidden: ${to}`)
    forbidden.push({ from, to, reason: reason.trim() })
  }

  // packages
  const packages: string[] = []
  for (const { text } of sectionLines(markdown, 'Packages')) {
    const m = text.match(/^-\s*(.+)$/)
    if (m) packages.push((m[1] ?? '').trim())
  }

  const layout = layoutHint(markdown, knownIds)

  return { title, summary, components, edges, forbidden, packages, ...(layout && { layout }) }
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

  return { status: 'unknown' }
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

  if (proposal.kind === 'component') {
    if (next.components.some((c) => c.id === proposal.id)) return next
    next.components.push({ id: proposal.id, purpose: proposal.purpose, owns: proposal.owns })
    return next
  }

  if (proposal.kind === 'edge') {
    if (next.edges.some((e) => e.from === proposal.from && e.to === proposal.to)) return next
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
