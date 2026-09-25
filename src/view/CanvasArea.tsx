import { useCallback, useMemo, useState } from 'react'
import KeyHintOverlay from '../shell/KeyHintOverlay'
import PaneTree from '../shell/PaneTree'
import { useCommands, type Command } from '../shell/commands'
import { close, focusDir, type Dir, type Pane, type Path } from '../shell/pane-tree'
import { PANE_BINDINGS, PANE_COMMAND_LABELS, viewAt, type usePanes } from '../shell/usePanes'
import { useLeaderKeys } from '../shell/useLeaderKeys'
import { VIEW_IDS, views, type ViewId } from '../shell/views'
import CommandPalette from './CommandPalette'

const PALETTE_KEYS = ['Space']

const MOVES: Record<string, Dir> = {
  'pane.focus.left': 'left',
  'pane.focus.down': 'down',
  'pane.focus.up': 'up',
  'pane.focus.right': 'right',
}

function reachable(id: string, tree: Pane, focus: Path): boolean {
  const dir = MOVES[id]
  if (dir) return focusDir(tree, focus, dir) !== focus
  if (id === 'pane.close') return close(tree, focus) !== null
  return true
}

type Panes = ReturnType<typeof usePanes>

export default function CanvasArea({ theme, panes }: { theme: string; panes: Panes }) {
  const { tree, focus, commands, focusPane, setRatio, showView } = panes
  const [palette, setPalette] = useState(false)
  const scope = viewAt(tree, focus)

  const registry = useMemo<Command[]>(() => {
    const bound = new Map(PANE_BINDINGS.map((binding) => [binding.command, binding]))

    return [
      ...Object.entries(commands).map(([id, run]) => ({
        id,
        label: PANE_COMMAND_LABELS[id] ?? id,
        run,
        keys: bound.get(id)?.keys,
        scope: bound.get(id)?.scope,
        enabled: reachable(id, tree, focus),
      })),
      { id: 'palette.open', label: 'Command palette', keys: PALETTE_KEYS, run: () => setPalette(true) },
    ]
  }, [commands, tree, focus])

  useCommands(registry)

  const { steps } = useLeaderKeys(scope)

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
      {palette && <CommandPalette scope={scope} onClose={() => setPalette(false)} />}
    </main>
  )
}
