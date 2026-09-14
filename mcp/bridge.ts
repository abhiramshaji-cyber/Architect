import { createConnection, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { SOCKET_PATH, type Request, type Proposal } from '../shared/types.js'

type RequestInput = { [K in Request['op']]: Omit<Extract<Request, { op: K }>, 'id' | 'cwd'> }[Request['op']]

type Waiter = { resolve: (result: unknown) => void; reject: (error: Error) => void }

const NOT_RUNNING = 'Architect app is not running. Open the Architect app and try again.'

const pending = new Map<string, Waiter>()
let socket: Socket | null = null
let connecting: Promise<Socket> | null = null
let buffer = ''

function onData(chunk: Buffer) {
  buffer += chunk.toString('utf8')

  let index: number
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line) dispatch(line)
  }
}

function dispatch(line: string) {
  const res = JSON.parse(line) as { id: string; ok: boolean; result?: unknown; error?: string }
  const waiter = pending.get(res.id)
  if (!waiter) return
  pending.delete(res.id)

  if (res.ok) waiter.resolve(res.result)
  else waiter.reject(new Error(res.error))
}

function failAll(error: Error) {
  for (const waiter of pending.values()) waiter.reject(error)
  pending.clear()
}

function onClose() {
  socket = null
  failAll(new Error('Architect connection closed unexpectedly.'))
}

function connect(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = createConnection(path)

    const onConnectError = () => reject(new Error(NOT_RUNNING))

    s.once('connect', () => {
      s.off('error', onConnectError)
      buffer = ''
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

export async function send(req: RequestInput, socketPath = SOCKET_PATH): Promise<unknown> {
  const full = { ...req, id: randomUUID(), cwd: process.cwd() } as Request
  const s = await getSocket(socketPath)

  return new Promise((resolve, reject) => {
    pending.set(full.id, { resolve, reject })
    s.write(JSON.stringify(full) + '\n')
  })
}

export function disconnect() {
  if (socket) socket.destroy()
  socket = null
  connecting = null
  buffer = ''
}

type ToolResult = { content: [{ type: 'text'; text: string }]; isError?: true }

async function callTool(req: RequestInput, socketPath: string): Promise<ToolResult> {
  try {
    const result = await send(req, socketPath)
    return { content: [{ type: 'text', text: JSON.stringify(result) }] }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { content: [{ type: 'text', text: message }], isError: true }
  }
}

export const getArchitecture = (socketPath = SOCKET_PATH) => callTool({ op: 'get_architecture' }, socketPath)

export const checkChange = (from: string, to: string, socketPath = SOCKET_PATH) =>
  callTool({ op: 'check_change', from, to }, socketPath)

export const proposeChange = (proposal: Proposal, rationale: string, socketPath = SOCKET_PATH) =>
  callTool({ op: 'propose_change', proposal, rationale }, socketPath)

export const awaitProposal = (proposalId: string, socketPath = SOCKET_PATH) =>
  callTool({ op: 'await_proposal', proposalId }, socketPath)

function main() {
  const server = new McpServer({ name: 'architect', version: '0.1.0' })

  server.registerTool('get_architecture', { description: 'Get the current architecture' }, () => getArchitecture())

  server.registerTool(
    'check_change',
    {
      description: 'Check whether a dependency between two components is allowed',
      inputSchema: { from: z.string(), to: z.string() },
    },
    ({ from, to }) => checkChange(from, to),
  )

  server.registerTool(
    'propose_change',
    {
      description:
        'Propose an architecture change for approval. For a file proposal, component is your best guess at the owner, not a certainty; the engineer can reassign it before approving.',
      inputSchema: {
        proposal: z.union([
          z.object({ kind: z.literal('component'), id: z.string(), purpose: z.string(), owns: z.array(z.string()) }),
          z.object({ kind: z.literal('edge'), from: z.string(), to: z.string() }),
          z.object({ kind: z.literal('package'), name: z.string(), component: z.string() }),
          z.object({
            kind: z.literal('file'),
            path: z.string(),
            component: z.string().describe('best guess at the owning component, not a certainty'),
          }),
        ]),
        rationale: z.string(),
      },
    },
    ({ proposal, rationale }) => proposeChange(proposal, rationale),
  )

  server.registerTool(
    'await_proposal',
    {
      description: 'Wait for a pending proposal to be approved or rejected',
      inputSchema: { proposalId: z.string() },
    },
    ({ proposalId }) => awaitProposal(proposalId),
  )

  const transport = new StdioServerTransport()
  server.connect(transport)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
