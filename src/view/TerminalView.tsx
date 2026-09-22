import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useProject } from '../model/store'
import type { PtyEvent } from '../../shared/types'
import type { ViewProps } from '../shell/views'

const DARK = { background: '#101014', foreground: '#e6e6e6', cursor: '#e6e6e6' }
const LIGHT = { background: '#ffffff', foreground: '#1b1b1f', cursor: '#1b1b1f' }

export default function TerminalView({ theme }: ViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const { currentRoot } = useProject()
  const [error, setError] = useState<string | null>(null)
  const [exited, setExited] = useState<number | null>(null)

  useEffect(() => {
    const mount = host.current
    if (!mount) return

    setExited(null)
    setError(null)

    const term = new Terminal({ fontSize: 12, cursorBlink: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(mount)
    terminal.current = term

    let session: string | null = null
    let disposed = false
    const early: PtyEvent[] = []

    function consume(event: PtyEvent) {
      if (event.type === 'data') term.write(event.chunk)
      else setExited(event.exitCode)
    }

    const offEvent = window.architect.onPtyEvent((event) => {
      if (session === null) early.push(event)
      else if (event.id === session) consume(event)
    })

    function resize() {
      try {
        fit.fit()
      } catch {
        return
      }
      if (session) window.architect.ptyResize(session, term.cols, term.rows)
    }

    resize()

    const input = term.onData((data) => {
      if (session) window.architect.ptyWrite(session, data)
    })

    const observer = new ResizeObserver(resize)
    observer.observe(mount)

    window.architect
      .ptySpawn({ cwd: currentRoot ?? undefined, cols: term.cols, rows: term.rows })
      .then((started) => {
        if (disposed) {
          window.architect.ptyKill(started.id)
          return
        }
        session = started.id
        for (const event of early.splice(0)) if (event.id === session) consume(event)
        resize()
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))

    return () => {
      disposed = true
      observer.disconnect()
      input.dispose()
      offEvent()
      if (session) window.architect.ptyKill(session)
      term.dispose()
      terminal.current = null
    }
  }, [currentRoot])

  useEffect(() => {
    if (terminal.current) terminal.current.options.theme = theme === 'light' ? LIGHT : DARK
  }, [theme])

  return (
    <>
      <header className="canvas-header">
        <h2>Terminal</h2>
        {exited !== null && <span className="muted">exited {exited}</span>}
      </header>
      {error && <div className="empty-state">{error}</div>}
      <div
        ref={host}
        className="terminal-host"
        style={{ background: theme === 'light' ? LIGHT.background : DARK.background }}
      />
    </>
  )
}
