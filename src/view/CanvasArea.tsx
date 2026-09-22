import { useCallback } from 'react'
import PaneTree from '../shell/PaneTree'
import type { usePanes } from '../shell/usePanes'
import { VIEW_IDS, views, type ViewId } from '../shell/views'
import type { Path } from '../shell/pane-tree'

type Panes = ReturnType<typeof usePanes>

export default function CanvasArea({ theme, panes }: { theme: string; panes: Panes }) {
  const { tree, focus, commands, focusPane, setRatio, showView } = panes

  const renderLeaf = useCallback(
    (view: ViewId, path: Path) => {
      const View = views[view].component
      return (
        <>
          <div className="pane-bar">
            <div className="mode-toggle">
              {VIEW_IDS.map((id) => (
                <button
                  key={id}
                  className={id === view ? 'mode active' : 'mode'}
                  onClick={() => showView(path, id)}
                >
                  {views[id].label}
                </button>
              ))}
            </div>
            <div className="pane-actions">
              <button className="pane-action" title="Split right (Alt+V)" onClick={commands['pane.split.right']}>
                Split right
              </button>
              <button className="pane-action" title="Split down (Alt+S)" onClick={commands['pane.split.down']}>
                Split down
              </button>
              <button className="pane-action" title="Close pane (Alt+Q)" onClick={commands['pane.close']}>
                Close
              </button>
            </div>
          </div>
          <View theme={theme} />
        </>
      )
    },
    [theme, commands, showView]
  )

  return (
    <main className="canvas-area">
      <PaneTree tree={tree} focus={focus} onFocus={focusPane} onResize={setRatio} renderLeaf={renderLeaf} />
    </main>
  )
}
