import type { Architecture, Component, Edge, Forbidden, Proposal, Verdict } from '../shared/types'

function nonEmptyLines(block: string): string[] {
  return block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
}

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`)
  if (start === -1) return ''
  const rest = markdown.slice(start + `## ${heading}`.length)
  const next = rest.search(/\n(## |<!--)/)
  return next === -1 ? rest : rest.slice(0, next)
}

export function parse(markdown: string): Architecture {
  const titleMatch = markdown.match(/^# (.+)$/m)
  const title = titleMatch?.[1]?.trim() ?? ''

  const afterTitle = titleMatch ? markdown.slice(markdown.indexOf(titleMatch[0]) + titleMatch[0].length) : markdown
  const summaryMatch = afterTitle.match(/^\s*\n+(.+)$/m)
  const summary = summaryMatch?.[1]?.trim() ?? ''

  // components
  const componentsBlock = section(markdown, 'Components')
  const componentChunks = componentsBlock.split(/\n### /).slice(1)
  const components: Component[] = []
  const seenIds = new Set<string>()

  for (const chunk of componentChunks) {
    const lines = chunk.split('\n')
    const id = (lines[0] ?? '').trim()
    if (id.length === 0) throw new Error('component id cannot be empty')
    if (/\s/.test(id) || id.includes('->')) {
      throw new Error(`invalid component id "${id}": ids must be one word with no spaces and no "->"`)
    }
    if (seenIds.has(id)) throw new Error(`duplicate component: ${id}`)
    seenIds.add(id)

    const body = nonEmptyLines(lines.slice(1).join('\n'))
    const ownsLines = body.filter((l) => l.startsWith('owns:'))
    const purposeLine = body.find((l) => !l.startsWith('owns:'))
    const owns = ownsLines.map((l) => l.match(/`([^`]*)`/)?.[1] ?? '')
    const purpose = purposeLine ?? ''

    components.push({ id, purpose, owns })
  }

  const knownIds = new Set(components.map((c) => c.id))

  // dependencies
  const edges: Edge[] = []
  for (const line of nonEmptyLines(section(markdown, 'Dependencies'))) {
    const m = line.match(/^-\s*(\S+)\s*->\s*(\S+)$/)
    if (!m) continue
    const from = m[1] ?? ''
    const to = m[2] ?? ''
    if (!knownIds.has(from)) throw new Error(`unknown component in dependency: ${from}`)
    if (!knownIds.has(to)) throw new Error(`unknown component in dependency: ${to}`)
    edges.push({ from, to })
  }

  // forbidden
  const forbidden: Forbidden[] = []
  for (const line of nonEmptyLines(section(markdown, 'Forbidden'))) {
    const m = line.match(/^-\s*(\S+)\s*->\s*(\S+)\s*:\s*(.+)$/)
    if (!m) continue
    const from = m[1] ?? ''
    const to = m[2] ?? ''
    const reason = m[3] ?? ''
    if (!knownIds.has(from)) throw new Error(`unknown component in forbidden: ${from}`)
    if (!knownIds.has(to)) throw new Error(`unknown component in forbidden: ${to}`)
    forbidden.push({ from, to, reason: reason.trim() })
  }

  // packages
  const packages: string[] = []
  for (const line of nonEmptyLines(section(markdown, 'Packages'))) {
    const m = line.match(/^-\s*(.+)$/)
    if (m) packages.push((m[1] ?? '').trim())
  }

  return { title, summary, components, edges, forbidden, packages }
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
