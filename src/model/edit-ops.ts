import { findCycle } from '../../shared/cycle'
import type { Architecture, Component } from '../../shared/types'

export type OpResult = { ok: true; architecture: Architecture } | { ok: false; error: string }

function fail(error: string): OpResult {
  return { ok: false, error }
}

function idError(id: string): string | null {
  if (id.length === 0) return 'id cannot be empty'
  if (/\s/.test(id) || id.includes('->')) {
    return `invalid id "${id}": ids must be one word with no spaces and no "->"`
  }
  return null
}

function find(a: Architecture, id: string): Component | undefined {
  return a.components.find((c) => c.id === id)
}

export function addComponent(a: Architecture, id: string): OpResult {
  const name = id.trim()
  const bad = idError(name)
  if (bad) return fail(bad)
  if (find(a, name)) return fail(`component "${name}" already exists`)

  return { ok: true, architecture: { ...a, components: [...a.components, { id: name, purpose: '', owns: [] }] } }
}

export function renameComponent(a: Architecture, from: string, to: string): OpResult {
  const source = from.trim()
  const target = to.trim()
  const bad = idError(target)
  if (bad) return fail(bad)
  if (!find(a, source)) return fail(`unknown component "${source}"`)
  if (source !== target && find(a, target)) return fail(`component "${target}" already exists`)

  const renamed = (id: string) => (id === source ? target : id)

  const layout = a.layout && Object.fromEntries(Object.entries(a.layout).map(([id, pt]) => [renamed(id), pt]))

  return {
    ok: true,
    architecture: {
      ...a,
      ...(layout && { layout }),
      components: a.components.map((c) => (c.id === source ? { ...c, id: target } : c)),
      edges: a.edges.map((e) => ({ ...e, from: renamed(e.from), to: renamed(e.to) })),
      forbidden: a.forbidden.map((f) => ({ ...f, from: renamed(f.from), to: renamed(f.to) }))
    }
  }
}

export function setPurpose(a: Architecture, id: string, purpose: string): OpResult {
  const name = id.trim()
  if (!find(a, name)) return fail(`unknown component "${name}"`)

  const text = purpose.trim()
  if (text.includes('\n')) return fail('purpose must be a single line')
  if (/^#{1,3} /.test(text)) return fail('purpose cannot start with a markdown heading')
  if (text.startsWith('<!--')) return fail('purpose cannot start with "<!--"')
  if (text.startsWith('owns:')) return fail('purpose cannot start with "owns:"')

  return {
    ok: true,
    architecture: { ...a, components: a.components.map((c) => (c.id === name ? { ...c, purpose: text } : c)) }
  }
}

export function setOwns(a: Architecture, id: string, owns: string[]): OpResult {
  const name = id.trim()
  if (!find(a, name)) return fail(`unknown component "${name}"`)

  const globs = [...new Set(owns.map((g) => g.trim()).filter((g) => g.length > 0))]
  for (const glob of globs) {
    if (glob.includes('\n')) return fail(`invalid owns "${glob}": must be a single line`)
    if (glob.includes('`')) return fail(`invalid owns "${glob}": cannot contain a backtick`)
  }

  return {
    ok: true,
    architecture: { ...a, components: a.components.map((c) => (c.id === name ? { ...c, owns: globs } : c)) }
  }
}

export function removeComponent(a: Architecture, id: string): OpResult {
  const name = id.trim()
  if (!find(a, name)) return fail(`unknown component "${name}"`)

  return {
    ok: true,
    architecture: {
      ...a,
      components: a.components.filter((c) => c.id !== name),
      edges: a.edges.filter((e) => e.from !== name && e.to !== name),
      forbidden: a.forbidden.filter((f) => f.from !== name && f.to !== name)
    }
  }
}

export function addEdge(a: Architecture, from: string, to: string): OpResult {
  const source = from.trim()
  const target = to.trim()
  if (!find(a, source)) return fail(`unknown component "${source}"`)
  if (!find(a, target)) return fail(`unknown component "${target}"`)
  if (source === target) return fail('a component cannot depend on itself')
  if (a.edges.some((e) => e.from === source && e.to === target)) {
    return fail(`edge "${source} -> ${target}" already exists`)
  }

  const blocked = a.forbidden.find((f) => f.from === source && f.to === target)
  if (blocked) return fail(`edge "${source} -> ${target}" is forbidden: ${blocked.reason}`)

  const cycle = findCycle(a.edges, source, target)
  if (cycle) return fail(`edge "${source} -> ${target}" would introduce a cycle: ${cycle.join(' -> ')}`)

  return { ok: true, architecture: { ...a, edges: [...a.edges, { from: source, to: target }] } }
}

export function removeEdge(a: Architecture, from: string, to: string): OpResult {
  const source = from.trim()
  const target = to.trim()
  if (!a.edges.some((e) => e.from === source && e.to === target)) {
    return fail(`no edge "${source} -> ${target}"`)
  }

  return {
    ok: true,
    architecture: { ...a, edges: a.edges.filter((e) => !(e.from === source && e.to === target)) }
  }
}
