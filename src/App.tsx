import { useCallback, useEffect, useState } from 'react'
import type { McpBridgeInfo } from '../shared/types'
import CanvasArea from './view/CanvasArea'
import ConnectMcpPanel from './view/ConnectMcpPanel'
import EditList from './view/EditList'
import PendingInbox from './view/PendingInbox'
import ProjectList from './view/ProjectList'
import StatusLine from './view/StatusLine'
import { at } from './shell/pane-tree'
import { usePanes } from './shell/usePanes'
import { views } from './shell/views'
import { parseErrorOf, start, useProject } from './model/store'

export default function App() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'dark')
  const [showConnectMcp, setShowConnectMcp] = useState(false)
  const [bridge, setBridge] = useState<McpBridgeInfo | null>(null)
  const project = useProject()
  const panes = usePanes(project.currentRoot)

  useEffect(start, [])

  const flipTheme = useCallback(() => {
    const next = theme === 'light' ? 'dark' : 'light'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('theme', next)
    } catch {}
    setTheme(next)
  }, [theme])

  const openConnectMcp = useCallback(() => {
    setShowConnectMcp(true)
    setBridge(null)
    window.architect.mcpBridgeInfo().then(setBridge)
  }, [])

  const activePane = at(panes.tree, panes.focus)
  const viewLabel = activePane?.kind === 'leaf' ? views[activePane.view].label : null

  return (
    <div className="app">
      <div className="app-body">
        <aside className="sidebar">
          <ProjectList theme={theme} onFlipTheme={flipTheme} onConnectMcp={openConnectMcp} />
          <EditList />
          <PendingInbox />
        </aside>

        <CanvasArea theme={theme} panes={panes} />
      </div>

      <StatusLine project={project} parseError={parseErrorOf(project)} viewLabel={viewLabel} />

      {showConnectMcp && <ConnectMcpPanel bridge={bridge} onClose={() => setShowConnectMcp(false)} />}
    </div>
  )
}
