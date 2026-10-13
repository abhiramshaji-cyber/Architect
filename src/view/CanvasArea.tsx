import { useCallback, useEffect, useMemo, useState } from 'react'
import KeyHintOverlay from '../shell/KeyHintOverlay'
import PaneTree from '../shell/PaneTree'
import { useCommands, type Command } from '../shell/commands'
import { close, focusDir, type Dir, type Pane, type Path } from '../shell/pane-tree'
import { PANE_BINDINGS, PANE_COMMAND_LABELS, viewAt, type usePanes } from '../shell/usePanes'
import { useLeaderKeys } from '../shell/useLeaderKeys'
import { PROJECT_VIEWS, shownView, views, type ViewId } from '../shell/views'
import { useProject } from '../model/store'
import CommandPalette from './CommandPalette'
import Icon, { type IconName } from './Icon'

const PALETTE_KEYS = ['Space']

const PANE_ACTIONS: { command: string; label: string; chord: string; icon: IconName }[] = [
  { command: 'pane.split.right', label: 'Split right', chord: 'space p v', icon: 'split-right' },
  { command: 'pane.split.down', label: 'Split down', chord: 'space p s', icon: 'split-down' },
  { command: 'pane.close', label: 'Close pane', chord: 'space p q', icon: 'close' },
]

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
  const rooted = useProject().currentRoot !== null
  const [palette, setPalette] = useState(false)
  const scope = shownView(viewAt(tree, focus), rooted)

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || !e.shiftKey || e.altKey || e.code !== 'KeyP') return
      e.preventDefault()
      setPalette(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const { steps } = useLeaderKeys(scope)

  const renderLeaf = useCallback(
    (stored: ViewId, path: Path) => {
      const view = shownView(stored, rooted)
      const View = views[view].component
      return (
        <>
          <div className="pane-bar">
            {rooted && (
              <nav className="mode-toggle">
                {PROJECT_VIEWS.map((id) => (
                  <button
                    key={id}
                    className={id === view ? 'mode active' : 'mode'}
                    aria-current={id === view ? 'page' : undefined}
                    onClick={() => showView(path, id)}
                  >
                    {views[id].label}
                  </button>
                ))}
              </nav>
            )}
            <div className="pane-actions">
              {PANE_ACTIONS.map((action) => (
                <button
                  key={action.command}
                  className="icon-button"
                  aria-label={action.label}
                  title={`${action.label} (${action.chord})`}
                  onClick={commands[action.command]}
                >
                  <Icon name={action.icon} />
                </button>
              ))}
            </div>
          </div>
          <View theme={theme} show={(next) => showView(path, next)} />
        </>
      )
    },
    [theme, commands, showView, rooted]
  )

  return (
    <main className="canvas-area">
      <PaneTree tree={tree} focus={focus} onFocus={focusPane} onResize={setRatio} renderLeaf={renderLeaf} />
      <KeyHintOverlay steps={steps} />
      {palette && <CommandPalette scope={scope} onClose={() => setPalette(false)} />}
    </main>
  )
}
