import { useCallback, useEffect, useState } from 'react'
import type { McpBridgeInfo } from '../shared/types'
import CanvasArea from './view/CanvasArea'
import ConnectMcpPanel from './view/ConnectMcpPanel'
import EditList from './view/EditList'
import PendingInbox from './view/PendingInbox'
import ProjectList from './view/ProjectList'
import { start } from './model/store'

export default function App() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'dark')
  const [showConnectMcp, setShowConnectMcp] = useState(false)
  const [bridge, setBridge] = useState<McpBridgeInfo | null>(null)

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

  return (
    <div className="app">
      <aside className="sidebar">
        <ProjectList theme={theme} onFlipTheme={flipTheme} onConnectMcp={openConnectMcp} />
        <EditList />
        <PendingInbox />
      </aside>

      <CanvasArea theme={theme} />

      {showConnectMcp && <ConnectMcpPanel bridge={bridge} onClose={() => setShowConnectMcp(false)} />}
    </div>
  )
}
