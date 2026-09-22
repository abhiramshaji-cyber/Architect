import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { Pane, Path } from './pane-tree'
import type { ViewId } from './views'

type Chrome = {
  focus: Path
  onFocus: (path: Path) => void
  onResize: (path: Path, ratio: number) => void
  renderLeaf: (view: ViewId, path: Path) => ReactNode
}

export default function PaneTree({ tree, ...chrome }: Chrome & { tree: Pane }) {
  return <Node pane={tree} path={[]} {...chrome} />
}

function Node({ pane, path, ...chrome }: Chrome & { pane: Pane; path: Path }) {
  if (pane.kind === 'split') return <Split pane={pane} path={path} {...chrome} />

  const focused = chrome.focus.length === path.length && chrome.focus.every((side, i) => side === path[i])

  return (
    <section
      className={focused ? 'pane focused' : 'pane'}
      onPointerDownCapture={() => chrome.onFocus(path)}
      onFocusCapture={() => chrome.onFocus(path)}
    >
      {chrome.renderLeaf(pane.view, path)}
    </section>
  )
}

function Split({
  pane,
  path,
  ...chrome
}: Chrome & { pane: Extract<Pane, { kind: 'split' }>; path: Path }) {
  const box = useRef<HTMLDivElement>(null)
  const { onResize } = chrome

  const drag = useCallback(
    (down: ReactPointerEvent<HTMLDivElement>) => {
      const handle = down.currentTarget
      down.preventDefault()
      handle.setPointerCapture(down.pointerId)

      const move = (at: PointerEvent) => {
        const rect = box.current?.getBoundingClientRect()
        if (!rect) return
        const along = pane.axis === 'row' ? (at.clientX - rect.left) / rect.width : (at.clientY - rect.top) / rect.height
        onResize(path, along)
      }

      const stop = () => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', stop)
        handle.removeEventListener('pointercancel', stop)
      }

      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', stop)
      handle.addEventListener('pointercancel', stop)
    },
    [pane.axis, path, onResize]
  )

  return (
    <div className={`pane-split ${pane.axis}`} ref={box}>
      <div className="pane-slot" style={{ flexGrow: pane.ratio }}>
        <Node pane={pane.a} path={[...path, 'a']} {...chrome} />
      </div>

      <div
        className="pane-divider"
        role="separator"
        aria-orientation={pane.axis === 'row' ? 'vertical' : 'horizontal'}
        onPointerDown={drag}
      />

      <div className="pane-slot" style={{ flexGrow: 1 - pane.ratio }}>
        <Node pane={pane.b} path={[...path, 'b']} {...chrome} />
      </div>
    </div>
  )
}
