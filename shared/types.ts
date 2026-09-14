import { tmpdir } from 'node:os'

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

export type Proposal =
  | { kind: 'component'; id: string; purpose: string; owns: string[] }
  | { kind: 'edge'; from: string; to: string }
  | { kind: 'package'; name: string; component: string }
  | { kind: 'file'; path: string; component: string }

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

export type Request =
  | { id: string; op: 'get_architecture'; cwd: string }
  | { id: string; op: 'check_change'; cwd: string; from: string; to: string }
  | { id: string; op: 'propose_change'; cwd: string; proposal: Proposal; rationale: string }
  | { id: string; op: 'await_proposal'; cwd: string; proposalId: string }
  | { id: string; op: 'list_edits'; cwd: string }
  | { id: string; op: 'get_edit'; cwd: string; editId: string }

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
