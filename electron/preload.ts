import { contextBridge, ipcRenderer } from 'electron'
import type { Architecture, ArchitectApi, CodeMap, Pending, ProjectSummary, PtyEvent } from '../shared/types'

const architect: ArchitectApi = {
  projects: () => ipcRenderer.invoke('architect:projects'),
  open: (root) => ipcRenderer.invoke('architect:open', root),
  pending: () => ipcRenderer.invoke('architect:pending'),
  mcpBridgeInfo: () => ipcRenderer.invoke('architect:mcp-bridge-info'),
  decide: (id, approved, reason, component) => ipcRenderer.invoke('architect:decide', id, approved, reason, component),
  edits: (root) => ipcRenderer.invoke('architect:edits', root),
  edit: (root, id) => ipcRenderer.invoke('architect:edit', root, id),
  createEdit: (root, architecture) => ipcRenderer.invoke('architect:create-edit', root, architecture),
  updateEdit: (root, id, architecture) => ipcRenderer.invoke('architect:update-edit', root, id, architecture),
  handEdit: (root, id) => ipcRenderer.invoke('architect:hand-edit', root, id),
  deleteEdit: (root, id) => ipcRenderer.invoke('architect:delete-edit', root, id),
  getCodeMap: (root) => ipcRenderer.invoke('architect:code-map', root),
  rescan: (root) => ipcRenderer.invoke('architect:rescan', root),
  ownership: (root) => ipcRenderer.invoke('architect:ownership', root),
  readSource: (root, file, from, length) =>
    ipcRenderer.invoke('architect:read-source', root, file, from, length),
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
  ptySpawn: (spec) => ipcRenderer.invoke('architect:pty-spawn', spec),
  ptyWrite: (id, data) => ipcRenderer.invoke('architect:pty-write', id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.invoke('architect:pty-resize', id, cols, rows),
  ptyKill: (id) => ipcRenderer.invoke('architect:pty-kill', id),
  onPtyEvent: (fn: (event: PtyEvent) => void) => {
    const listener = (_event: unknown, payload: PtyEvent) => fn(payload)
    ipcRenderer.on('architect:pty-event', listener)
    return () => ipcRenderer.off('architect:pty-event', listener)
  },
}

contextBridge.exposeInMainWorld('architect', architect)
