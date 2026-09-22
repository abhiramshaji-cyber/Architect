import type { ViewId } from './views'

export type Axis = 'row' | 'col'
export type Side = 'a' | 'b'
export type Path = Side[]
export type Dir = 'left' | 'right' | 'up' | 'down'

export type Pane =
  | { kind: 'leaf'; view: ViewId }
  | { kind: 'split'; axis: Axis; a: Pane; b: Pane; ratio: number }

export const MIN_RATIO = 0.1
export const EVEN_RATIO = 0.5

const AXIS_OF: Record<Dir, Axis> = { left: 'row', right: 'row', up: 'col', down: 'col' }
const TOWARD: Record<Dir, Side> = { left: 'a', right: 'b', up: 'a', down: 'b' }

export function leaf(view: ViewId): Pane {
  return { kind: 'leaf', view }
}

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return EVEN_RATIO
  return Math.min(Math.max(ratio, MIN_RATIO), 1 - MIN_RATIO)
}

export function at(root: Pane, path: Path): Pane | null {
  let pane = root
  for (const side of path) {
    if (pane.kind !== 'split') return null
    pane = pane[side]
  }
  return pane
}

function replace(root: Pane, path: Path, make: (pane: Pane) => Pane | null): Pane | null {
  if (path.length === 0) return make(root)
  if (root.kind !== 'split') return root

  const side = path[0]
  if (!side) return root
  const next = replace(root[side], path.slice(1), make)

  if (next === null) return side === 'a' ? root.b : root.a
  if (next === root[side]) return root
  return side === 'a' ? { ...root, a: next } : { ...root, b: next }
}

function edge(pane: Pane, axis: Axis, side: Side): Path {
  const path: Path = []
  let cur = pane

  while (cur.kind === 'split') {
    const step: Side = cur.axis === axis ? side : 'a'
    path.push(step)
    cur = cur[step]
  }

  return path
}

export function split(root: Pane, path: Path, axis: Axis, view: ViewId): Pane {
  const made = replace(root, path, (pane) => ({ kind: 'split', axis, a: pane, b: leaf(view), ratio: EVEN_RATIO }))
  return made ?? root
}

export function setView(root: Pane, path: Path, view: ViewId): Pane {
  const made = replace(root, path, (pane) => (pane.kind === 'leaf' ? leaf(view) : pane))
  return made ?? root
}

export function close(root: Pane, path: Path): Pane | null {
  return replace(root, path, () => null)
}

export function resize(root: Pane, path: Path, ratio: number): Pane {
  const made = replace(root, path, (pane) => (pane.kind === 'split' ? { ...pane, ratio: clampRatio(ratio) } : pane))
  return made ?? root
}

export function focusDir(root: Pane, path: Path, dir: Dir): Path {
  const axis = AXIS_OF[dir]
  const toward = TOWARD[dir]
  const from: Side = toward === 'a' ? 'b' : 'a'

  for (let depth = path.length - 1; depth >= 0; depth--) {
    const parent = at(root, path.slice(0, depth))
    if (!parent || parent.kind !== 'split') continue
    if (parent.axis !== axis || path[depth] !== from) continue
    return [...path.slice(0, depth), toward, ...edge(parent[toward], axis, from)]
  }

  return path
}

export function clampPath(root: Pane, path: Path): Path {
  const kept: Path = []
  let cur = root

  for (const side of path) {
    if (cur.kind !== 'split') break
    kept.push(side)
    cur = cur[side]
  }

  return [...kept, ...edge(cur, 'row', 'a')]
}

export function serialize(root: Pane): string {
  return JSON.stringify(root)
}

export function parse(text: string, known: (view: string) => boolean): Pane | null {
  try {
    return validate(JSON.parse(text), known)
  } catch {
    return null
  }
}

function validate(value: unknown, known: (view: string) => boolean): Pane | null {
  if (typeof value !== 'object' || value === null) return null
  const node = value as Record<string, unknown>

  if (node.kind === 'leaf') {
    return typeof node.view === 'string' && known(node.view) ? leaf(node.view as ViewId) : null
  }

  if (node.kind !== 'split' || (node.axis !== 'row' && node.axis !== 'col')) return null
  if (typeof node.ratio !== 'number') return null

  const a = validate(node.a, known)
  const b = validate(node.b, known)

  if (!a || !b) return a ?? b
  return { kind: 'split', axis: node.axis, a, b, ratio: clampRatio(node.ratio) }
}
