import { contextBridge, ipcRenderer } from 'electron'
import type { Architecture, ArchitectApi, CodeMap, IpcResult, Pending, ProjectSummary, PtyEvent } from '../shared/types'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const architect: ArchitectApi = {
  projects: () => invoke('architect:projects'),
  chooseDirectory: () => invoke('architect:choose-directory'),
  createContract: (root) => invoke('architect:create-contract', root),
  open: (root) => invoke('architect:open', root),
  closeProject: (root) => invoke('architect:close-project', root),
  pending: () => invoke('architect:pending'),
  decide: (id, approved, reason, component) => invoke('architect:decide', id, approved, reason, component),
  edits: (root) => invoke('architect:edits', root),
  edit: (root, id) => invoke('architect:edit', root, id),
  createEdit: (root, architecture) => invoke('architect:create-edit', root, architecture),
  updateEdit: (root, id, architecture) => invoke('architect:update-edit', root, id, architecture),
  handEdit: (root, id) => invoke('architect:hand-edit', root, id),
  deleteEdit: (root, id) => invoke('architect:delete-edit', root, id),
  getCodeMap: (root) => invoke('architect:code-map', root),
  rescan: (root) => invoke('architect:rescan', root),
  ownership: (root) => invoke('architect:ownership', root),
  readSource: (root, file, from, length) =>
    invoke('architect:read-source', root, file, from, length),
  onChange: (fn: (a: Architecture) => void) => {
    ipcRenderer.on('architect:change', (_event, architecture: Architecture) => fn(architecture))
  },
  onPending: (fn: (p: Pending[]) => void) => {
    ipcRenderer.on('architect:pending-update', (_event, pending: Pending[]) => fn(pending))
  },
  onProjects: (fn: (p: ProjectSummary[]) => void) => {
    ipcRenderer.on('architect:projects-update', (_event, projects: ProjectSummary[]) => fn(projects))
  },
  onCodeMap: (fn: (root: string, map: CodeMap) => void) => {
    ipcRenderer.on('architect:code-map-update', (_event, root: string, map: CodeMap) => fn(root, map))
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
  gitLocalBranches: (root) => invoke('architect:git-local-branches', root),
  gitRemoteBranches: (root) => invoke('architect:git-remote-branches', root),
  gitWorktrees: (root) => invoke('architect:git-worktrees', root),
  gitFetch: (root) => invoke('architect:git-fetch', root),
  gitCreateWorktree: (root, path, name, base) =>
    invoke('architect:git-create-worktree', root, path, name, base),
  gitRemoveWorktree: (root, path) => invoke('architect:git-remove-worktree', root, path),
  gitPruneWorktrees: (root) => invoke('architect:git-prune-worktrees', root),
  githubAuth: () => invoke('architect:github-auth'),
  githubRepos: (limit) => invoke('architect:github-repos', limit),
  githubBranches: (owner, repo) => invoke('architect:github-branches', owner, repo),
  githubRates: () => invoke('architect:github-rates'),
  githubPulls: (owner, repo) => invoke('architect:github-pulls', owner, repo),
  repoPlan: (repo, branch, pr) => invoke('architect:repo-plan', repo, branch, pr),
  repoOpen: (repo, branch, choice, pr) => invoke('architect:repo-open', repo, branch, choice, pr),
}

contextBridge.exposeInMainWorld('architect', architect)
