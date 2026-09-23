import { z } from 'zod'

export type Component = {
  id: string
  purpose: string
  owns: string[]
}

export type Edge = { from: string; to: string }

export type Forbidden = { from: string; to: string; reason: string }

export type Pt = { x: number; y: number }

export type Layout = Record<string, Pt>

export function isPt(value: unknown): value is Pt {
  const pt = value as Pt | null | undefined
  if (!pt || typeof pt !== 'object') return false
  return Number.isFinite(pt.x) && Number.isFinite(pt.y) && pt.x >= 0 && pt.y >= 0
}

export type Architecture = {
  title: string
  summary: string
  components: Component[]
  edges: Edge[]
  forbidden: Forbidden[]
  packages: string[]
  layout?: Layout
}

export type SourceError = 'closed' | 'range' | 'outside' | 'unreadable' | 'binary'

export type SourceWindow = {
  from: number
  lines: string[]
  total: number
  error: SourceError | null
}

export type Ownership = {
  owned: { path: string; owner: string }[]
  unowned: string[]
  multi: { path: string; owners: string[] }[]
  dead: { component: string; pattern: string }[]
}

export const proposalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('component'), id: z.string(), purpose: z.string(), owns: z.array(z.string()) }),
  z.object({ kind: z.literal('remove_component'), id: z.string() }),
  z.object({ kind: z.literal('edge'), from: z.string(), to: z.string() }),
  z.object({ kind: z.literal('package'), name: z.string(), component: z.string() }),
  z.object({ kind: z.literal('file'), path: z.string(), component: z.string() }),
])

export type Proposal = z.infer<typeof proposalSchema>

export const pendingSchema = z.object({
  id: z.string(),
  projectRoot: z.string(),
  proposal: proposalSchema,
  rationale: z.string(),
  createdAt: z.number(),
})

export type Pending = z.infer<typeof pendingSchema>

export type EditStatus = 'draft' | 'handed'

export type Edit = { id: string; status: EditStatus; architecture: Architecture }

export type EditSummary = { id: string; status: EditStatus; title: string; error?: string }

export type Verdict =
  | { status: 'allowed' }
  | { status: 'forbidden'; reason: string }
  | { status: 'unknown-component'; ids: string[] }
  | { status: 'cycle'; path: string[] }
  | { status: 'undrawn-edge' }
  | { status: 'unknown'; reason?: string }

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

export type CallRef = { file: string; fn: number }

export type FunctionEntry = { name: string; line: number; endLine: number; description: string; calls: CallRef[] }

export type FileEntry = { path: string; functions: FunctionEntry[] }

export type FolderEntry = { path: string; folders: string[]; files: FileEntry[] }

export type CodeMap = { root: string; scannedAt: number; folders: FolderEntry[] }

export type ContractState =
  | { status: 'ready' }
  | { status: 'missing' }
  | { status: 'invalid'; error: string }

export type ProjectSummary = { root: string; title: string; contract: ContractState }

export type OpenedProject = { contract: ContractState; architecture: Architecture | null }

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

export type Head =
  | { kind: 'branch'; branch: string; commit: string | null }
  | { kind: 'detached'; commit: string }

export type GitStatus = {
  head: Head
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
  dirty: boolean
}

export type Worktree = {
  path: string
  head: string | null
  branch: string | null
  detached: boolean
  bare: boolean
  locked: boolean
  prunable: boolean
  exists: boolean
}

export type LocalBranch = { name: string; commit: string; upstream: string | null; current: boolean }

export type RemoteBranch = { name: string; commit: string }

export type DefaultBranch = { remote: string; branch: string }

export type WorktreeCreated = { path: string; branch: string; base: string }

export type GitFailure =
  | { kind: 'not-installed' }
  | { kind: 'missing-root'; root: string }
  | { kind: 'not-a-repo'; root: string }
  | { kind: 'no-commits'; root: string }
  | { kind: 'no-remote'; root: string }
  | { kind: 'no-default-branch'; remote: string }
  | { kind: 'bad-ref'; ref: string }
  | { kind: 'not-in-ref'; ref: string; file: string }
  | { kind: 'bad-argument'; value: string }
  | { kind: 'invalid-branch'; name: string }
  | { kind: 'branch-exists'; name: string }
  | { kind: 'branch-checked-out'; name: string; path: string }
  | { kind: 'worktree-exists'; path: string }
  | { kind: 'no-worktree'; path: string }
  | { kind: 'main-worktree'; path: string }
  | { kind: 'locked-worktree'; path: string }
  | { kind: 'dirty'; root: string }
  | { kind: 'failed'; args: string[]; code: number | null; stderr: string }

export type GitResult<T> = { ok: true; value: T } | { ok: false; error: GitFailure }

export type GithubAccount = { host: string; login: string; scopes: string[] }

export type GithubAuth =
  | { kind: 'logged-in'; account: GithubAccount }
  | { kind: 'insufficient-scopes'; account: GithubAccount; missing: string[] }
  | { kind: 'logged-out'; host: string }
  | { kind: 'not-installed' }
  | { kind: 'unreachable'; host: string; detail: string }

export type GithubRepo = {
  nameWithOwner: string
  name: string
  owner: string
  description: string
  isPrivate: boolean
  isFork: boolean
  isArchived: boolean
  defaultBranch: string | null
  pushedAt: string | null
  url: string
  language: string | null
}

export type GithubBranch = { name: string; commit: string; protected: boolean }

export type GithubBudget = { limit: number; remaining: number; resetAt: number }

export type GithubRates = { core: GithubBudget; graphql: GithubBudget; search: GithubBudget }

export type GithubFailure =
  | { kind: 'not-installed' }
  | { kind: 'auth-required' }
  | { kind: 'not-found' }
  | { kind: 'bad-argument'; value: string }
  | { kind: 'rate-limited'; resource: string; resetAt: number }
  | { kind: 'unreachable'; detail: string }
  | { kind: 'timed-out'; args: string[] }
  | { kind: 'unreadable'; args: string[] }
  | { kind: 'failed'; args: string[]; code: number; stderr: string }

export type GithubResult<T> = { ok: true; value: T } | { ok: false; error: GithubFailure }

export type PtySpec = { cwd?: string; shell?: string; args?: string[]; cols: number; rows: number }

export type PtySession = { id: string; pid: number }

export type PtyEvent =
  | { type: 'data'; id: string; chunk: string }
  | { type: 'exit'; id: string; exitCode: number; signal?: number }

export type ArchitectApi = {
  projects(): Promise<ProjectSummary[]>
  chooseDirectory(): Promise<string | null>
  open(root: string): Promise<OpenedProject>
  closeProject(root: string): Promise<void>
  pending(): Promise<Pending[]>
  decide(id: string, approved: boolean, reason?: string, component?: string): Promise<void>
  createContract(root: string): Promise<Architecture>
  edits(root: string): Promise<EditSummary[]>
  edit(root: string, id: string): Promise<Edit>
  createEdit(root: string, architecture: Architecture): Promise<Edit>
  updateEdit(root: string, id: string, architecture: Architecture): Promise<Edit>
  handEdit(root: string, id: string): Promise<Edit>
  deleteEdit(root: string, id: string): Promise<void>
  getCodeMap(root: string): Promise<CodeMap | null>
  rescan(root: string): Promise<CodeMap>
  ownership(root: string): Promise<Ownership | null>
  readSource(root: string, file: string, from: number, length: number): Promise<SourceWindow>
  onChange(fn: (a: Architecture) => void): void
  onPending(fn: (p: Pending[]) => void): void
  onProjects(fn: (p: ProjectSummary[]) => void): void
  onCodeMap(fn: (root: string, map: CodeMap) => void): void
  ptySpawn(spec: PtySpec): Promise<PtySession>
  ptyWrite(id: string, data: string): Promise<boolean>
  ptyResize(id: string, cols: number, rows: number): Promise<boolean>
  ptyKill(id: string): Promise<boolean>
  onPtyEvent(fn: (event: PtyEvent) => void): () => void
  gitStatus(root: string): Promise<GitResult<GitStatus>>
  gitDefaultBranch(root: string): Promise<GitResult<DefaultBranch>>
  gitLocalBranches(root: string): Promise<GitResult<LocalBranch[]>>
  gitRemoteBranches(root: string): Promise<GitResult<RemoteBranch[]>>
  gitWorktrees(root: string): Promise<GitResult<Worktree[]>>
  gitFetch(root: string): Promise<GitResult<{ remote: string }>>
  gitCreateWorktree(root: string, path: string, name: string, base?: string): Promise<GitResult<WorktreeCreated>>
  gitRemoveWorktree(root: string, path: string): Promise<GitResult<{ path: string }>>
  gitPruneWorktrees(root: string): Promise<GitResult<Worktree[]>>
  githubAuth(): Promise<GithubResult<GithubAuth>>
  githubRepos(limit?: number): Promise<GithubResult<GithubRepo[]>>
  githubBranches(owner: string, repo: string): Promise<GithubResult<GithubBranch[]>>
  githubRates(): Promise<GithubResult<GithubRates>>
}

export type Response =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string }

export const PROPOSAL_TIMEOUT_MS = 5 * 60 * 1000
