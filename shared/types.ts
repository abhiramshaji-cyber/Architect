import { tmpdir } from 'node:os'
import { z } from 'zod'

export type Component = {
  id: string
  purpose: string
  owns: string[]
}

export type Edge = { from: string; to: string }

export type Forbidden = { from: string; to: string; reason: string }

export type Architecture = {
  title: string
  summary: string
  components: Component[]
  edges: Edge[]
  forbidden: Forbidden[]
  packages: string[]
}

export const proposalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('component'), id: z.string(), purpose: z.string(), owns: z.array(z.string()) }),
  z.object({ kind: z.literal('edge'), from: z.string(), to: z.string() }),
  z.object({ kind: z.literal('package'), name: z.string(), component: z.string() }),
  z.object({ kind: z.literal('file'), path: z.string(), component: z.string() }),
])

export type Proposal = z.infer<typeof proposalSchema>

export type Pending = {
  id: string
  projectRoot: string
  proposal: Proposal
  rationale: string
  createdAt: number
}

export type EditStatus = 'draft' | 'handed'

export type Edit = { id: string; status: EditStatus; architecture: Architecture }

export type EditSummary = { id: string; status: EditStatus; title: string; error?: string }

export type Verdict =
  | { status: 'allowed' }
  | { status: 'forbidden'; reason: string }
  | { status: 'unknown' }

export type Decision =
  | { status: 'approved' }
  | { status: 'rejected'; reason: string }
  | { status: 'pending'; id: string }

export const requestSchema = z.discriminatedUnion('op', [
  z.object({ id: z.string(), op: z.literal('get_architecture'), cwd: z.string() }),
  z.object({ id: z.string(), op: z.literal('check_change'), cwd: z.string(), from: z.string(), to: z.string() }),
  z.object({
    id: z.string(),
    op: z.literal('propose_change'),
    cwd: z.string(),
    proposal: proposalSchema,
    rationale: z.string(),
  }),
  z.object({ id: z.string(), op: z.literal('await_proposal'), cwd: z.string(), proposalId: z.string() }),
  z.object({ id: z.string(), op: z.literal('list_edits'), cwd: z.string() }),
  z.object({ id: z.string(), op: z.literal('get_edit'), cwd: z.string(), editId: z.string() }),
])

export type Request = z.infer<typeof requestSchema>

export type FunctionEntry = { name: string; line: number; endLine: number; description: string; calls: number[] }

export type FileEntry = { path: string; functions: FunctionEntry[] }

export type FolderEntry = { path: string; folders: string[]; files: FileEntry[] }

export type CodeMap = { root: string; scannedAt: number; folders: FolderEntry[] }

export type ArchitectApi = {
  projects(): Promise<{ root: string; title: string }[]>
  open(root: string): Promise<Architecture>
  pending(): Promise<Pending[]>
  decide(id: string, approved: boolean, reason?: string, component?: string): Promise<void>
  mcpBridgeInfo(): Promise<McpBridgeInfo>
  edits(root: string): Promise<EditSummary[]>
  edit(root: string, id: string): Promise<Edit>
  createEdit(root: string, architecture: Architecture): Promise<Edit>
  updateEdit(root: string, id: string, architecture: Architecture): Promise<Edit>
  handEdit(root: string, id: string): Promise<Edit>
  deleteEdit(root: string, id: string): Promise<void>
  getCodeMap(root: string): Promise<CodeMap | null>
  rescan(root: string): Promise<CodeMap>
  readSource(root: string, file: string, from: number, to: number): Promise<string>
  onChange(fn: (a: Architecture) => void): void
  onPending(fn: (p: Pending[]) => void): void
  onProjects(fn: (p: { root: string; title: string }[]) => void): void
}

export type McpBridgeInfo = { path: string; exists: boolean }

export type Response =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string }

const home = process.env.HOME ?? process.env.USERPROFILE ?? tmpdir()

export const SOCKET_PATH =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\architect'
    : `${home}/.architect/sock`

export const PROPOSAL_TIMEOUT_MS = 5 * 60 * 1000
