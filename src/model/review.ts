import { useSyncExternalStore } from 'react'
import { errorText } from '../../shared/text/error'
import type { Architecture, ReviewItem, ReviewState } from '../../shared/types'

export type Mark = 'added' | 'removed' | 'changed' | 'touched'

export type Overlay = { architecture: Architecture; marks: Record<string, Mark> }

type Store = ReviewState & { error: string | null }

let state: Store = { enabled: false, items: [], error: null }

const listeners = new Set<() => void>()

function set(patch: Partial<Store>): void {
  state = { ...state, ...patch }
  for (const listen of listeners) listen()
}

function failed(err: unknown): void {
  set({ error: errorText(err) })
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen)
  return () => listeners.delete(listen)
}

export function useReview(): Store {
  return useSyncExternalStore(subscribe, () => state)
}

export function startReview(): () => void {
  const stop = window.architect.onReview((next) => set({ ...next, error: null }))
  window.architect.review().then((next) => set({ ...next, error: null }), failed)
  return stop
}

export function toggleReview(): void {
  window.architect.setReview(!state.enabled).then((next) => set({ ...next, error: null }), failed)
}

export function decide(id: string, approved: boolean, feedback?: string): void {
  window.architect.decide(id, approved, feedback).catch(failed)
}

export function reviewText(review: ReviewState): string {
  const count = review.items.length
  if (!review.enabled) return count === 0 ? '' : `Review off · ${count} pending`
  return count === 0 ? 'Review on' : `Review on · ${count} pending`
}

export function describeItem(item: ReviewItem): string {
  if (item.kind === 'code') return `${item.tool === 'Write' ? 'Write' : 'Edit'} ${item.file}`

  const proposal = item.proposal
  if (proposal.kind === 'component') return `Add component ${proposal.id}`
  if (proposal.kind === 'remove_component') return `Remove component ${proposal.id}`
  if (proposal.kind === 'edge') return `Add dependency ${proposal.from} -> ${proposal.to}`
  if (proposal.kind === 'package') return `Add package ${proposal.name} to ${proposal.component}`
  if (proposal.kind === 'file') return `Give ${proposal.path} to ${proposal.component}`
  return 'Adopt a first architect.md'
}

const edgeId = (edge: { from: string; to: string }) => `${edge.from}->${edge.to}`

export function overlay(before: Architecture | null, after: Architecture | null, owners: string[]): Overlay | null {
  const now = after ?? before
  if (!now) return null

  const old = new Map((before?.components ?? []).map((c) => [c.id, c]))
  const next = new Map(now.components.map((c) => [c.id, c]))
  const marks: Record<string, Mark> = {}

  for (const [id, component] of next) {
    const was = old.get(id)
    if (!was) marks[id] = 'added'
    else if (was.purpose !== component.purpose || was.owns.join('\n') !== component.owns.join('\n')) marks[id] = 'changed'
  }
  for (const id of old.keys()) if (!next.has(id)) marks[id] = 'removed'
  for (const id of owners) if (!marks[id] && (next.has(id) || old.has(id))) marks[id] = 'touched'

  const oldEdges = new Set((before?.edges ?? []).map(edgeId))
  const newEdges = new Set(now.edges.map(edgeId))
  for (const id of newEdges) if (!oldEdges.has(id)) marks[id] = 'added'
  for (const id of oldEdges) if (!newEdges.has(id)) marks[id] = 'removed'

  const gone = (before?.components ?? []).filter((c) => !next.has(c.id))
  const cut = (before?.edges ?? []).filter((e) => !newEdges.has(edgeId(e)))
  const architecture = {
    ...now,
    components: [...now.components, ...gone],
    edges: [...now.edges, ...cut],
    layout: now.layout ?? before?.layout,
  }
  return { architecture, marks }
}
