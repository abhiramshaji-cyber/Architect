import { createConnection, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { SOCKET_PATH } from '../shared/socket.js'
import { type Request, type Proposal, PROPOSAL_TIMEOUT_MS } from '../shared/types.js'

type RequestInput = { [K in Request['op']]: Omit<Extract<Request, { op: K }>, 'id' | 'cwd'> }[Request['op']]

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
  const deadline =
    timeoutMs ??
    (req.op === 'propose_change' || req.op === 'await_proposal' ? PROPOSAL_TIMEOUT_MS + 30_000 : 30_000)

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

export const listEdits = (socketPath = SOCKET_PATH) => callTool({ op: 'list_edits' }, socketPath)

export const getEdit = (editId: string, socketPath = SOCKET_PATH) =>
  callTool({ op: 'get_edit', editId }, socketPath)

function main() {
  const server = new McpServer({ name: 'architect', version: '0.1.0' })

  server.registerTool('get_architecture', { description: 'Get the current architecture' }, () => getArchitecture())

  server.registerTool(
    'check_change',
    {
      description:
        'Check whether a dependency between two components is allowed. The verdict is allowed, forbidden with a reason, unknown-component naming the id(s) not on the canvas (propose a component), or undrawn-edge when both components exist but the edge is not drawn (propose an edge).',
      inputSchema: { from: z.string(), to: z.string() },
    },
    ({ from, to }) => checkChange(from, to),
  )

  server.registerTool(
    'propose_change',
    {
      description:
        'Propose an architecture change for approval. For a file proposal, component is your best guess at the owner, not a certainty; the engineer can reassign it before approving. A remove_component proposal deletes a component along with every edge and forbidden rule touching it; any file it owned becomes unowned rather than being deleted.',
      inputSchema: {
        proposal: z.union([
          z.object({ kind: z.literal('component'), id: z.string(), purpose: z.string(), owns: z.array(z.string()) }),
          z.object({ kind: z.literal('remove_component'), id: z.string() }),
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

  server.registerTool(
    'list_edits',
    {
      description:
        'List the architecture edits the engineer has drawn for this project. Each entry has an id, a title and a status. A handed edit is the architecture the engineer intends this project to have: read it, discuss it, and implement it, never ignore it. A draft is still being worked on, so treat it as unfinished and do not act on it unless the engineer asks. An entry carrying an error field could not be read and should be reported back to the engineer rather than guessed at.',
    },
    () => listEdits(),
  )

  server.registerTool(
    'get_edit',
    {
      description:
        'Get the full architecture of one edit by id. Use it after list_edits, normally on a handed edit, to read the components, dependencies, forbidden dependencies and packages the engineer intends.',
      inputSchema: { editId: z.string() },
    },
    ({ editId }) => getEdit(editId),
  )

  const transport = new StdioServerTransport()
  server.connect(transport)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
