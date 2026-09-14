import { contextBridge, ipcRenderer } from 'electron'
import type { Architecture, ArchitectApi, Pending } from '../shared/types'

const architect: ArchitectApi = {
  projects: () => ipcRenderer.invoke('architect:projects'),
  add: () => ipcRenderer.invoke('architect:add'),
  open: (root) => ipcRenderer.invoke('architect:open', root),
  pending: () => ipcRenderer.invoke('architect:pending'),
  mcpBridgeInfo: () => ipcRenderer.invoke('architect:mcp-bridge-info'),
  decide: (id, approved, reason, component) => ipcRenderer.invoke('architect:decide', id, approved, reason, component),
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
