import { randomUUID } from 'node:crypto'
import os from 'node:os'
import process from 'node:process'
import type { PtyEvent, PtySpec } from '../../shared/types'

const FLUSH_MS = 8
const FLUSH_BYTES = 64 * 1024
const MAX_PENDING = 1024 * 1024

export type PtyProcess = {
  pid: number
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

export type PtySpawner = (
  file: string,
  args: string[],
  options: { name: string; cwd: string; cols: number; rows: number; env: Record<string, string> },
) => PtyProcess

type Session = {
  pty: PtyProcess
  pending: string
  timer: ReturnType<typeof setTimeout> | null
  listeners: { dispose(): void }[]
  alive: boolean
}

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC ?? 'powershell.exe'
  return process.env.SHELL ?? '/bin/bash'
}

function cells(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.trunc(value)) : fallback
}

function shellEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  env.TERM = 'xterm-256color'
  return env
}

export function createPtyHost(spawn: PtySpawner, send: (event: PtyEvent) => void) {
  const sessions = new Map<string, Session>()

  function flush(id: string, session: Session) {
    if (session.timer) {
      clearTimeout(session.timer)
      session.timer = null
    }
    if (session.pending.length === 0) return

    const chunk = session.pending
    session.pending = ''
    send({ type: 'data', id, chunk })
  }

  function push(id: string, session: Session, data: string) {
    session.pending += data
    if (session.pending.length > MAX_PENDING) session.pending = session.pending.slice(-MAX_PENDING)

    if (session.pending.length >= FLUSH_BYTES) {
      flush(id, session)
      return
    }

    if (session.timer) return
    session.timer = setTimeout(() => flush(id, session), FLUSH_MS)
    session.timer.unref?.()
  }

  function close(id: string, session: Session) {
    if (session.timer) clearTimeout(session.timer)
    session.timer = null
    session.alive = false
    for (const listener of session.listeners) listener.dispose()
    session.listeners = []
    sessions.delete(id)
  }

  function spawnSession(spec: PtySpec) {
    const id = randomUUID()
    const cols = cells(spec.cols, 80)
    const rows = cells(spec.rows, 24)
    const file = spec.shell ?? defaultShell()
    const pty = spawn(file, spec.args ?? [], {
      name: 'xterm-256color',
      cwd: spec.cwd ?? os.homedir(),
      cols,
      rows,
      env: shellEnv(),
    })

    const session: Session = { pty, pending: '', timer: null, listeners: [], alive: true }
    sessions.set(id, session)

    session.listeners.push(pty.onData((data) => push(id, session, data)))
    session.listeners.push(
      pty.onExit(({ exitCode, signal }) => {
        if (!sessions.has(id)) return
        flush(id, session)
        close(id, session)
        send({ type: 'exit', id, exitCode, signal })
      }),
    )

    return { id, pid: pty.pid }
  }

  function live(id: string): Session | null {
    const session = sessions.get(id)
    return session && session.alive ? session : null
  }

  return {
    spawn: spawnSession,

    write(id: string, data: string) {
      const session = live(id)
      if (!session) return false

      try {
        session.pty.write(data)
        return true
      } catch {
        return false
      }
    },

    resize(id: string, cols: number, rows: number) {
      const session = live(id)
      if (!session) return false
      if (!Number.isFinite(cols) || !Number.isFinite(rows)) return false

      try {
        session.pty.resize(cells(cols, 80), cells(rows, 24))
        return true
      } catch {
        return false
      }
    },

    kill(id: string) {
      const session = live(id)
      if (!session) return false

      session.alive = false
      try {
        session.pty.kill()
        return true
      } catch {
        close(id, session)
        return false
      }
    },

    killAll() {
      for (const [id, session] of [...sessions]) {
        try {
          session.pty.kill('SIGKILL')
        } catch {
          session.alive = false
        }
        close(id, session)
      }
    },

    ids: () => [...sessions.keys()],
  }
}
