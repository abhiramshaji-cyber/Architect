import { contextBridge, ipcRenderer } from 'electron'
import type { Architecture, ArchitectApi, Pending } from '../shared/types'

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
  onChange: (fn: (a: Architecture) => void) => {
    ipcRenderer.on('architect:change', (_event, architecture: Architecture) => fn(architecture))
  },
  onPending: (fn: (p: Pending[]) => void) => {
    ipcRenderer.on('architect:pending-update', (_event, pending: Pending[]) => fn(pending))
  },
  onProjects: (fn: (p: { root: string; title: string }[]) => void) => {
    ipcRenderer.on('architect:projects-update', (_event, projects: { root: string; title: string }[]) => fn(projects))
  },
}

contextBridge.exposeInMainWorld('architect', architect)
