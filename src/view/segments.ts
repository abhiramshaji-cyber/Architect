export type Segment = { id: string; order: number; text: string }

const MAX_LEN = 80

export function truncate(text: string, max = MAX_LEN): string {
  if (text.length <= max) return text
  if (max <= 1) return text.slice(0, Math.max(max, 0))
  return text.slice(0, max - 1) + '…'
}

const segments = new Map<string, Segment>()
const listeners = new Set<() => void>()
let snapshot: Segment[] = []

function refresh(): void {
  snapshot = [...segments.values()].sort((a, b) => a.order - b.order)
  for (const listen of listeners) listen()
}

export function registerSegment(segment: Segment): () => void {
  segments.set(segment.id, { ...segment, text: truncate(segment.text) })
  refresh()
  return () => {
    if (!segments.delete(segment.id)) return
    refresh()
  }
}

export function subscribeSegments(listen: () => void): () => void {
  listeners.add(listen)
  return () => {
    listeners.delete(listen)
  }
}

export function segmentList(): Segment[] {
  return snapshot
}
