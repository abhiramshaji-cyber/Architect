import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { SOCKET_PATH } from '../shared/socket.js'
import { runHook } from './hook.js'
import { send, type RequestInput } from './socket.js'
import type { Proposal } from '../shared/types.js'

export { send, disconnect } from './socket.js'

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

type ChangeInput = { from?: string; to?: string; file?: string; content?: string }

export const checkChange = (
  input: ChangeInput,
  socketPath = SOCKET_PATH,
  session = process.env.CLAUDE_CODE_SESSION_ID || undefined,
) => callTool({ op: 'check_change', ...input, ...(session ? { session } : {}) }, socketPath)

export const proposeChange = (proposal: Proposal, rationale: string, socketPath = SOCKET_PATH) =>
  callTool({ op: 'propose_change', proposal, rationale }, socketPath)

export const awaitProposal = (proposalId: string, socketPath = SOCKET_PATH) =>
  callTool({ op: 'await_proposal', proposalId }, socketPath)

export const listEdits = (socketPath = SOCKET_PATH) => callTool({ op: 'list_edits' }, socketPath)

export const writeAgents = (socketPath = SOCKET_PATH) => callTool({ op: 'write_agents' }, socketPath)

type PlaceInput = { calls?: string[]; callers?: string[]; name?: string; file?: string }

export const where = ({ calls = [], callers = [], name, file }: PlaceInput, socketPath = SOCKET_PATH) =>
  callTool({ op: 'where', calls, callers, ...(name === undefined ? {} : { name }), ...(file === undefined ? {} : { file }) }, socketPath)

export const getEdit = (editId: string, socketPath = SOCKET_PATH) =>
  callTool({ op: 'get_edit', editId }, socketPath)

function main() {
  const server = new McpServer({ name: 'architect', version: '0.1.0' })

  server.registerTool('get_architecture', { description: 'Get the current architecture' }, () => getArchitecture())

  server.registerTool(
    'check_change',
    {
      description:
        'Check a change before making it. Pass from and to to check a dependency between two components: the verdict is allowed, forbidden with a reason, unknown-component naming the id(s) not on the canvas (propose a component), or undrawn-edge when both components exist but the edge is not drawn (propose an edge). Pass file and its full proposed content to check the file against the Rules section of architect.md (lines per file, code files per folder, banned names, one job per file): the verdict is allowed, or rule-violation listing each rule the change would break or worsen with its file, line and message. Violations the file already had and does not worsen are not reported. Pass both to check both.',
      inputSchema: {
        from: z.string().optional(),
        to: z.string().optional(),
        file: z.string().optional().describe('path of the file to write, absolute or relative to the working directory'),
        content: z.string().optional().describe('the full text the file would hold after the change'),
      },
    },
    (input) => checkChange(input),
  )

  server.registerTool(
    'propose_change',
    {
      description:
        'Change architect.md. When the engineer has change review turned off in Architect the change is written at once; when it is on, the call waits until they approve or reject it in Architect. The result is approved once written, rejected with a reason (a cycle, an unknown component, a forbidden rule, a missing or broken contract, or the engineer said no, often with a better way to do it that you should follow), or pending with an id when nobody answered in time: call await_proposal with that id to keep waiting. For a file proposal, component is the owning component. A remove_component proposal deletes a component along with every edge and forbidden rule touching it; any file it owned becomes unowned rather than being deleted.',
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
      description:
        'Keep waiting on a proposal that propose_change returned as pending. Returns approved, rejected with the engineer\'s reason, or pending again with the same id.',
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

  server.registerTool(
    'write_agents',
    {
      description:
        'Write an AGENTS.md into the folder each component\'s globs share, copied from architect.md: what the component owns, what it may call, what it must never call and the rules that apply there. Files are rewritten only when their content changes, a hand written AGENTS.md is never overwritten, generated files for removed components are deleted, and once any exist Architect keeps them in step with architect.md. Returns the files written, unchanged, removed and kept, and each component that has no folder of its own with the reason.',
    },
    () => writeAgents(),
  )

  server.registerTool(
    'where',
    {
      description:
        'Ask where a new function belongs before writing it. Pass the functions it will call and the functions or files that will call it, each as a function name, a file path (relative to the working directory, else to the project root), or file:name when a name is in several files, plus optionally its proposed name and file. Every answer comes from the scan, architect.md and its Rules, with counts and file:line evidence, and no model call. component is the component owning the most matched neighbours among those whose calls to and from the new function architect.md allows; it is tied, blocked, unowned, no-match or no-contract instead of guessing. folder is where most of those neighbours live, and newFile says whether a new file there fits the files rule or the function should go in an existing file. verb is the leading word most function names in that folder start with. similar is the function sharing the most callees, then callers, to copy. file checks the proposed file against the Rules with a stub of the function. A reference that matches nothing or several files is listed in notes and never counted. Without architect.md the answer is by folder only.',
      inputSchema: {
        calls: z.array(z.string()).optional().describe('functions the new function will call: name, file path, or file:name'),
        callers: z.array(z.string()).optional().describe('functions or files that will call the new function: name, file path, or file:name'),
        name: z.string().optional().describe('proposed function name'),
        file: z.string().optional().describe('proposed file, absolute or relative to the working directory'),
      },
    },
    (input) => where(input),
  )

  const transport = new StdioServerTransport()
  server.connect(transport)
  send({ op: 'session-event', event: 'connect' }).catch(() => {})
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === 'hook') void runHook().finally(() => process.exit(0))
  else main()
}
