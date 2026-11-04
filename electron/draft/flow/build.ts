import picomatch from 'picomatch'
import { findCycle } from '../../../shared/cycle'
import type { Architecture, Component, DraftResult, Edge } from '../../../shared/types'
import { parse, serialize } from '../../contract/graph'
import type { Evidence } from './evidence'
import { type Reply, replyOf } from './reply'

const unusable = (detail: string): DraftResult<string> => ({
  ok: false,
  error: { kind: 'unusable', detail },
})

function prose(raw: string, fallback: string): string {
  return raw === '' || /^(#|-|owns:|covers:|scope:)/.test(raw) ? fallback : raw
}

function ancestors(file: string, base: string): string[] {
  const parts = file.slice(base.length).split('/').slice(0, -1)
  return parts.map((_, at) => base + parts.slice(0, at + 1).join('/'))
}

function ownersOfFiles(reply: Reply, found: Evidence): Map<string, string> {
  const tally = new Map<string, Map<string, number>>()
  for (const group of reply.groups) {
    for (const at of group.functions) {
      const file = found.functions[at]?.row.file
      if (file === undefined) continue
      const counts = tally.get(file) ?? new Map<string, number>()
      counts.set(group.id, (counts.get(group.id) ?? 0) + 1)
      tally.set(file, counts)
    }
  }
  return new Map(
    [...tally].map(([file, counts]) => [
      file,
      [...counts].reduce((best, next) => (next[1] > best[1] ? next : best))[0],
    ]),
  )
}

function ownersUnder(owner: Map<string, string>, found: Evidence, base: string): Map<string, Set<string>> {
  const under = new Map<string, Set<string>>()
  for (const file of found.indexed) {
    for (const dir of ancestors(file, base)) under.set(dir, (under.get(dir) ?? new Set()).add(owner.get(file) ?? '\0'))
  }
  return under
}

function globsFor(id: string, owner: Map<string, string>, under: Map<string, Set<string>>, base: string): string[] {
  const globs: string[] = []
  for (const file of [...owner]
    .filter(([, o]) => o === id)
    .map(([f]) => f)
    .sort()) {
    if (globs.some((glob) => picomatch.isMatch(file, glob, { dot: true }))) continue
    const dir = ancestors(file, base).find((d) => under.get(d)?.size === 1 && under.get(d)?.has(id))
    const glob = [...(dir === undefined ? [] : [`${dir}/**`]), file].find(
      (g) => !g.includes('`') && picomatch.isMatch(file, g, { dot: true }),
    )
    if (glob !== undefined) globs.push(glob)
  }
  return globs
}

function edgesOf(reply: Reply, found: Evidence, ids: Set<string>): Edge[] {
  const fnOwner = new Map(reply.groups.flatMap((g) => g.functions.map((at) => [at, g.id] as const)))
  const called = found.calls.flatMap(([a, b]) => {
    const from = fnOwner.get(a)
    const to = fnOwner.get(b)
    return from !== undefined && to !== undefined && from !== to ? [{ from, to, label: '' }] : []
  })

  const edges: Edge[] = []
  for (const flow of [...reply.flows, ...called]) {
    if (!ids.has(flow.from) || !ids.has(flow.to)) continue
    if (edges.some((e) => e.from === flow.from && e.to === flow.to)) continue
    if (findCycle(edges, flow.from, flow.to)) continue
    edges.push(flow.label === '' ? { from: flow.from, to: flow.to } : flow)
  }
  return edges
}

export function validate(text: string, found: Evidence, title: string, scope = ''): DraftResult<string> {
  const reply = replyOf(text, found)
  if (typeof reply === 'string') return unusable(reply)

  const base = scope === '' ? '' : `${scope}/`
  const owner = ownersOfFiles(reply, found)
  const under = ownersUnder(owner, found, base)
  const components: Component[] = reply.groups.map((group) => {
    const covers = group.functions
      .map((at) => found.functions[at]?.row)
      .flatMap((row) => (row && !`${row.file}${row.name}`.includes('`') ? [`${row.file}#${row.name}`] : []))
    return {
      id: group.id,
      purpose: prose(group.purpose, group.id),
      owns: globsFor(group.id, owner, under, base),
      ...(covers.length > 0 && { covers }),
    }
  })

  if (!components.some((c) => c.owns.length > 0))
    return unusable('no component in the reply covers a function Architect indexed')

  const architecture: Architecture = {
    title: prose(reply.title, title),
    summary: prose(reply.summary, `The architecture of ${title}.`),
    components,
    edges: edgesOf(reply, found, new Set(components.map((c) => c.id))),
    forbidden: [],
    packages: [],
    ...(scope !== '' && { scope }),
  }

  const markdown = serialize(architecture)
  try {
    parse(markdown)
  } catch (err) {
    return unusable(err instanceof Error ? err.message : String(err))
  }
  return { ok: true, value: markdown }
}
