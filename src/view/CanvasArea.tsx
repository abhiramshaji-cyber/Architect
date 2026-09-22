import { useCallback, useMemo } from 'react'
import KeyHintOverlay from '../shell/KeyHintOverlay'
import PaneTree from '../shell/PaneTree'
import { PANE_BINDINGS, PANE_COMMAND_LABELS, viewAt, type usePanes } from '../shell/usePanes'
import { useLeaderKeys, type CommandEntry } from '../shell/useLeaderKeys'
import { VIEW_IDS, views, type ViewId } from '../shell/views'
import type { Path } from '../shell/pane-tree'

type Panes = ReturnType<typeof usePanes>

export default function CanvasArea({ theme, panes }: { theme: string; panes: Panes }) {
  const { tree, focus, commands, focusPane, setRatio, showView } = panes

  const paneCommands = useMemo<Record<string, CommandEntry>>(
    () =>
      Object.fromEntries(
        Object.entries(commands).map(([id, run]) => [id, { run, label: PANE_COMMAND_LABELS[id] ?? id }])
      ),
    [commands]
  )

  const { steps } = useLeaderKeys(PANE_BINDINGS, paneCommands, viewAt(tree, focus))

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
              <button className="pane-action" title="Split right (space p v)" onClick={commands['pane.split.right']}>
                Split right
              </button>
              <button className="pane-action" title="Split down (space p s)" onClick={commands['pane.split.down']}>
                Split down
              </button>
              <button className="pane-action" title="Close pane (space p q)" onClick={commands['pane.close']}>
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
      <KeyHintOverlay steps={steps} />
    </main>
  )
}
