import { createConnection, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { SOCKET_PATH } from '../shared/socket.js'
import { PROPOSAL_TIMEOUT_MS, type Request } from '../shared/types.js'

export type RequestInput = { [K in Request['op']]: Omit<Extract<Request, { op: K }>, 'id' | 'cwd'> }[Request['op']]

type Waiter = { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

const NOT_RUNNING = 'Architect app is not running. Open the Architect app and try again.'

const pending = new Map<string, Waiter>()
let socket: Socket | null = null
let connecting: Promise<Socket> | null = null
let buffer = ''
let decoder = new StringDecoder('utf8')

function onData(chunk: Buffer) {
  buffer += decoder.write(chunk)

  let index: number
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line) dispatch(line)
  }
}

function drop(line: string, why: string) {
  const preview = line.length > 200 ? `${line.slice(0, 200)}...` : line
  process.stderr.write(`architect bridge discarded a line (${why}): ${preview}\n`)
}

function dispatch(line: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return drop(line, 'not JSON')
  }

  const res = parsed as { id?: unknown; ok?: unknown; result?: unknown; error?: unknown }
  if (typeof parsed !== 'object' || parsed === null || typeof res.id !== 'string') {
    return drop(line, 'not a response')
  }

  const waiter = pending.get(res.id)
  if (!waiter) return
  clearTimeout(waiter.timer)
  pending.delete(res.id)

  if (res.ok === true) waiter.resolve(res.result)
  else if (res.ok === false) waiter.reject(new Error(typeof res.error === 'string' ? res.error : 'Architect reported an error with no message.'))
  else waiter.reject(new Error('Architect sent a reply that was not a result or an error.'))
}

function failAll(error: Error) {
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer)
    waiter.reject(error)
  }
  pending.clear()
}

function connect(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = createConnection(path)

    const onConnectError = () => reject(new Error(NOT_RUNNING))

    const onClose = () => {
      if (socket !== s) return
      socket = null
      failAll(new Error('Architect connection closed unexpectedly.'))
    }

    s.once('connect', () => {
      s.off('error', onConnectError)
      buffer = ''
      decoder = new StringDecoder('utf8')
      s.on('data', onData)
      s.on('close', onClose)
      s.on('error', onClose)
      socket = s
      resolve(s)
    })

    s.once('error', onConnectError)
  })
}

async function getSocket(path: string): Promise<Socket> {
  if (socket) return socket
  if (!connecting) connecting = connect(path).finally(() => (connecting = null))
  return connecting
}

export async function send(req: RequestInput, socketPath = SOCKET_PATH, timeoutMs?: number): Promise<unknown> {
  const full = { ...req, id: randomUUID(), cwd: process.cwd() } as Request
  const s = await getSocket(socketPath)
  const waits = req.op === 'propose_change' || req.op === 'await_proposal'
  const deadline = timeoutMs ?? (waits ? PROPOSAL_TIMEOUT_MS + 30_000 : 30_000)

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(full.id)
      reject(new Error(`Architect did not respond in ${Math.round(deadline / 1000)}s; is the app still running?`))
    }, deadline)
    pending.set(full.id, { resolve, reject, timer })
    s.write(JSON.stringify(full) + '\n')
  })
}

export function disconnect() {
  if (socket) socket.destroy()
  socket = null
  connecting = null
  buffer = ''
  decoder = new StringDecoder('utf8')
  failAll(new Error('Architect connection closed.'))
}
