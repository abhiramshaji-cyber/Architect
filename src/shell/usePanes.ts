import { useEffect, useMemo, useState } from 'react'
import {
  at,
  clampPath,
  close,
  focusDir,
  leaf,
  parse,
  resize,
  serialize,
  setView,
  split,
  type Axis,
  type Dir,
  type Pane,
  type Path,
} from './pane-tree'
import { DEFAULT_VIEW, isViewId, type ViewId } from './views'

type Layout = { root: string | null; tree: Pane; focus: Path }

const STORE_PREFIX = 'panes:'

const KEYS: Record<string, string> = {
  KeyV: 'pane.split.right',
  KeyS: 'pane.split.down',
  KeyQ: 'pane.close',
  KeyH: 'pane.focus.left',
  KeyJ: 'pane.focus.down',
  KeyK: 'pane.focus.up',
  KeyL: 'pane.focus.right',
}

function load(root: string | null): Layout {
  const fallback: Layout = { root, tree: leaf(DEFAULT_VIEW), focus: [] }
  if (!root) return fallback

  try {
    const stored = localStorage.getItem(STORE_PREFIX + root)
    const tree = stored ? parse(stored, isViewId) : null
    return tree ? { root, tree, focus: clampPath(tree, []) } : fallback
  } catch {
    return fallback
  }
}

function save(layout: Layout): void {
  if (!layout.root) return
  try {
    localStorage.setItem(STORE_PREFIX + layout.root, serialize(layout.tree))
  } catch {}
}

function viewAt(tree: Pane, path: Path): ViewId {
  const pane = at(tree, path)
  return pane && pane.kind === 'leaf' ? pane.view : DEFAULT_VIEW
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function usePanes(root: string | null) {
  const [layout, setLayout] = useState<Layout>(() => load(root))

  if (layout.root !== root) setLayout(load(root))

  useEffect(() => {
    save(layout)
  }, [layout.root, layout.tree])

  const commands = useMemo(() => {
    const splitTo = (axis: Axis) =>
      setLayout((now) => ({
        ...now,
        tree: split(now.tree, now.focus, axis, viewAt(now.tree, now.focus)),
        focus: [...now.focus, 'b' as const],
      }))

    const move = (dir: Dir) => setLayout((now) => ({ ...now, focus: focusDir(now.tree, now.focus, dir) }))

    return {
      'pane.split.right': () => splitTo('row'),
      'pane.split.down': () => splitTo('col'),
      'pane.close': () =>
        setLayout((now) => {
          const tree = close(now.tree, now.focus) ?? leaf(DEFAULT_VIEW)
          return { ...now, tree, focus: clampPath(tree, now.focus) }
        }),
      'pane.focus.left': () => move('left'),
      'pane.focus.down': () => move('down'),
      'pane.focus.up': () => move('up'),
      'pane.focus.right': () => move('right'),
    } as Record<string, () => void>
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return
      const name = KEYS[e.code]
      const run = name ? commands[name] : undefined
      if (!run) return
      e.preventDefault()
      run()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commands])

  const panes = useMemo(
    () => ({
      focusPane: (path: Path) => setLayout((now) => ({ ...now, focus: path })),
      setRatio: (path: Path, ratio: number) => setLayout((now) => ({ ...now, tree: resize(now.tree, path, ratio) })),
      showView: (path: Path, view: ViewId) =>
        setLayout((now) => ({ ...now, tree: setView(now.tree, path, view), focus: path })),
    }),
    []
  )

  return { tree: layout.tree, focus: layout.focus, commands, ...panes }
}
