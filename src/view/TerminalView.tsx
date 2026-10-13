import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useProject } from '../model/store'
import type { PtyEvent } from '../../shared/types'
import type { ViewProps } from '../shell/views'

const DARK = { background: '#0b0b0c', foreground: '#e4e4e4', cursor: '#e4e4e4', cursorAccent: '#0b0b0c', selectionBackground: '#3a3a3d' }
const LIGHT = { background: '#fafafa', foreground: '#1a1a1a', cursor: '#1a1a1a', cursorAccent: '#fafafa', selectionBackground: '#d6d6d6' }
const FONT = "'Geist Mono Variable', 'SF Mono', ui-monospace, monospace"

export function latchedRoot(held: string | null, current: string | null): string | null {
  return held ?? current
}

export default function TerminalView({ theme, tmux = true }: ViewProps & { tmux?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const { currentRoot } = useProject()
  const [bound, setBound] = useState<string | null>(currentRoot)
  const [startedIn, setStartedIn] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exited, setExited] = useState<number | null>(null)

  useEffect(() => {
    setBound((held) => latchedRoot(held, currentRoot))
  }, [currentRoot])

  useEffect(() => {
    const mount = host.current
    if (!mount || bound === null) return

    setExited(null)
    setError(null)

    const term = new Terminal({ fontSize: 13, lineHeight: 1.35, fontFamily: FONT, cursorBlink: true })
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
      .ptySpawn({ cwd: bound, tmux, cols: term.cols, rows: term.rows })
      .then((started) => {
        if (disposed) {
          window.architect.ptyKill(started.id)
          return
        }
        session = started.id
        setStartedIn(started.cwd ?? bound)
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
  }, [bound, tmux])

  useEffect(() => {
    if (terminal.current) terminal.current.options.theme = theme === 'light' ? LIGHT : DARK
  }, [theme])

  return (
    <>
      {(startedIn || exited !== null) && (
        <header className="terminal-head">
          {startedIn && <span className="canvas-path">{startedIn}</span>}
          {exited !== null && <span className="muted">exited {exited}</span>}
        </header>
      )}
      {bound === null ? (
        <div className="empty-state">No project open</div>
      ) : (
        <>
          {error && <div className="empty-state">{error}</div>}
          <div
            ref={host}
            className="terminal-host"
            style={{ background: theme === 'light' ? LIGHT.background : DARK.background }}
          />
        </>
      )}
    </>
  )
}

export function PlainShell(props: ViewProps) {
  return <TerminalView {...props} tmux={false} />
}
