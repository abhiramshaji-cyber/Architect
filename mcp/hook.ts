import { createConnection } from 'node:net'
import { randomUUID } from 'node:crypto'
import { SOCKET_PATH } from '../shared/socket.js'
import type { Request } from '../shared/types.js'

const DEADLINE_MS = 1500

type SessionEvent = Extract<Request, { op: 'session-event' }>

const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

export function sessionEvent(raw: string): SessionEvent | null {
  let input: unknown
  try {
    input = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof input !== 'object' || input === null) return null

  const { cwd, session_id, hook_event_name, tool_input } = input as Record<string, unknown>
  const target = (typeof tool_input === 'object' && tool_input !== null ? tool_input : {}) as Record<string, unknown>
  const where = text(cwd)
  const event = text(hook_event_name)
  if (!where || !event) return null

  const file = text(target.file_path) ?? text(target.notebook_path)
  return { id: randomUUID(), op: 'session-event', cwd: where, event, session: text(session_id), file }
}

async function readStdin(): Promise<string> {
  let raw = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) raw += chunk
  return raw
}

function deliver(event: SessionEvent, socketPath: string): Promise<void> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath)
    socket.once('connect', () => socket.end(`${JSON.stringify(event)}\n`))
    socket.once('close', () => resolve())
    socket.once('error', () => resolve())
  })
}

export async function runHook(socketPath = SOCKET_PATH): Promise<void> {
  setTimeout(() => process.exit(0), DEADLINE_MS).unref()
  const event = sessionEvent(await readStdin())
  if (event) await deliver(event, socketPath)
}
