import { contextBridge, ipcRenderer } from 'electron'
import type {
  Architecture,
  ArchitectApi,
  CodeMap,
  GithubCompared,
  HistoryEntry,
  IpcResult,
  ProjectSummary,
  PtyEvent,
  ReviewState,
  SessionTouch,
} from '../shared/types'
import type { JevProgress } from '../shared/jev/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const architect: ArchitectApi = {
  projects: () => invoke('architect:projects'),
  createContract: (root) => invoke('architect:create-contract', root),
  draftContract: (root) => invoke('architect:draft-contract', root),
  open: (root) => invoke('architect:open', root),
  closeProject: (root) => invoke('architect:close-project', root),
  claimRoot: (root) => invoke('architect:claim-root', root),
  releaseRoot: () => invoke('architect:release-root'),
  focusRoot: (root) => invoke('architect:focus-root', root),
  history: (root) => invoke('architect:history', root),
  verdicts: (root) => invoke('architect:verdicts', root),
  edits: (root) => invoke('architect:edits', root),
  edit: (root, id) => invoke('architect:edit', root, id),
  createEdit: (root, architecture) => invoke('architect:create-edit', root, architecture),
  updateEdit: (root, id, architecture) => invoke('architect:update-edit', root, id, architecture),
  handEdit: (root, id) => invoke('architect:hand-edit', root, id),
  deleteEdit: (root, id) => invoke('architect:delete-edit', root, id),
  getCodeMap: (root) => invoke('architect:code-map', root),
  rescan: (root) => invoke('architect:rescan', root),
  listFunctions: (root, scope) => invoke('architect:list-functions', root, scope),
  ownership: (root) => invoke('architect:ownership', root),
  layers: (root) => invoke('architect:layers', root),
  flow: (root, ask) => invoke('architect:flow', root, ask),
  recency: (root) => invoke('architect:recency', root),
  churn: (root, days) => invoke('architect:churn', root, days),
  coupling: (root, ask) => invoke('architect:coupling', root, ask),
  style: (root) => invoke('architect:style', root),
  conventions: (root) => invoke('architect:conventions', root),
  setConventions: (root, enabled) => invoke('architect:set-conventions', root, enabled),
  suggestConventions: (root) => invoke('architect:suggest-conventions', root),
  promoteConvention: (root, rule) => invoke('architect:promote-convention', root, rule),
  readSource: (root, file, from, length) =>
    invoke('architect:read-source', root, file, from, length),
  openSource: (root, file) => invoke('architect:open-source', root, file),
  writeSource: (root, file, text, baseline) =>
    invoke('architect:write-source', root, file, text, baseline),
  readTree: (root, dir) => invoke('architect:read-tree', root, dir),
  search: (query) => invoke('architect:search', query),
  onChange: (fn: (root: string, architecture: Architecture) => void) => {
    ipcRenderer.on('architect:change', (_event, root: string, architecture: Architecture) => fn(root, architecture))
  },
  onHistory: (fn: (entry: HistoryEntry) => void) => {
    const listener = (_event: unknown, entry: HistoryEntry) => fn(entry)
    ipcRenderer.on('architect:history', listener)
    return () => ipcRenderer.off('architect:history', listener)
  },
  onProjects: (fn: (p: ProjectSummary[]) => void) => {
    ipcRenderer.on('architect:projects-update', (_event, projects: ProjectSummary[]) => fn(projects))
  },
  onCodeMap: (fn: (root: string, map: CodeMap) => void) => {
    ipcRenderer.on('architect:code-map-update', (_event, root: string, map: CodeMap) => fn(root, map))
  },
  onTouch: (fn: (touch: SessionTouch) => void) => {
    ipcRenderer.on('architect:touch', (_event, touch: SessionTouch) => fn(touch))
  },
  ptySpawn: (spec) => invoke('architect:pty-spawn', spec),
  ptyWrite: (id, data) => invoke('architect:pty-write', id, data),
  ptyResize: (id, cols, rows) => invoke('architect:pty-resize', id, cols, rows),
  ptyKill: (id) => invoke('architect:pty-kill', id),
  onPtyEvent: (fn: (event: PtyEvent) => void) => {
    const listener = (_event: unknown, payload: PtyEvent) => fn(payload)
    ipcRenderer.on('architect:pty-event', listener)
    return () => ipcRenderer.off('architect:pty-event', listener)
  },
  gitStatus: (root) => invoke('architect:git-status', root),
  gitDefaultBranch: (root) => invoke('architect:git-default-branch', root),
  tabTitle: (root) => invoke('architect:tab-title', root),
  gitLocalBranches: (root) => invoke('architect:git-local-branches', root),
  gitRemoteBranches: (root) => invoke('architect:git-remote-branches', root),
  gitFetch: (root) => invoke('architect:git-fetch', root),
  gitDistance: (root) => invoke('architect:git-distance', root),
  gitCommits: (root, since, limit) => invoke('architect:git-commits', root, since, limit),
  gitChanges: (root) => invoke('architect:git-changes', root),
  gitFileDiff: (root, section, file, full) => invoke('architect:git-file-diff', root, section, file, full),
  gitStageFile: (root, file) => invoke('architect:git-stage-file', root, file),
  gitUnstageFile: (root, file) => invoke('architect:git-unstage-file', root, file),
  gitStageAll: (root) => invoke('architect:git-stage-all', root),
  gitCommit: (root, title, description) => invoke('architect:git-commit', root, title, description),
  gitPush: (root) => invoke('architect:git-push', root),
  gitPull: (root) => invoke('architect:git-pull', root),
  draftCommitMessage: (root) => invoke('architect:draft-commit-message', root),
  draftPullRequest: (root) => invoke('architect:draft-pull-request', root),
  askContract: (root, question, turns, view) => invoke('architect:ask-contract', root, question, turns, view),
  githubAuth: () => invoke('architect:github-auth'),
  githubRepos: (limit) => invoke('architect:github-repos', limit),
  githubBranches: (owner, repo) => invoke('architect:github-branches', owner, repo),
  githubRates: () => invoke('architect:github-rates'),
  githubPulls: (owner, repo) => invoke('architect:github-pulls', owner, repo),
  githubPullFor: (root, head) => invoke('architect:github-pull-for', root, head),
  githubCreatePull: (root, base, head, title, body) =>
    invoke('architect:github-create-pull', root, base, head, title, body),
  githubCompare: (owner, repo, base, heads) => invoke('architect:github-compare', owner, repo, base, heads),
  githubCancelCompare: () => invoke('architect:github-compare-cancel'),
  onGithubCompared: (fn: (compared: GithubCompared) => void) => {
    const listener = (_event: unknown, payload: GithubCompared) => fn(payload)
    ipcRenderer.on('architect:github-compared', listener)
    return () => ipcRenderer.off('architect:github-compared', listener)
  },
  repoPlan: (repo, branch, pr) => invoke('architect:repo-plan', repo, branch, pr),
  repoOpen: (repo, branch, choice, pr) => invoke('architect:repo-open', repo, branch, choice, pr),
  review: () => invoke('architect:review'),
  setReview: (enabled) => invoke('architect:set-review', enabled),
  aiState: () => invoke('architect:ai-state'),
  chooseAi: (choice) => invoke('architect:choose-ai', choice),
  jevState: (root) => invoke('architect:jev-state', root),
  setJevKey: (key) => invoke('architect:jev-set-key', key),
  removeJevKey: () => invoke('architect:jev-remove-key'),
  setJev: (enabled, root) => invoke('architect:jev-set', enabled, root),
  indexJev: (root) => invoke('architect:jev-index', root),
  cancelJev: (root) => invoke('architect:jev-cancel', root),
  setJevBudget: (tokens) => invoke('architect:jev-budget', tokens),
  sameBehavior: (root, file, symbol) => invoke('architect:jev-same', root, file, symbol),
  onJev: (fn: (progress: JevProgress) => void) => {
    const listener = (_event: unknown, progress: JevProgress) => fn(progress)
    ipcRenderer.on('architect:jev', listener)
    return () => ipcRenderer.off('architect:jev', listener)
  },
  reviewDetail: (id) => invoke('architect:review-detail', id),
  decide: (id, approved, feedback) => invoke('architect:decide', id, approved, feedback),
  onReview: (fn: (state: ReviewState) => void) => {
    const listener = (_event: unknown, state: ReviewState) => fn(state)
    ipcRenderer.on('architect:review', listener)
    return () => ipcRenderer.off('architect:review', listener)
  },
}

contextBridge.exposeInMainWorld('architect', architect)
