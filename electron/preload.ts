import { contextBridge, ipcRenderer } from 'electron'
import type { Architecture, ArchitectApi, Pending } from '../shared/types'

const architect: ArchitectApi = {
  projects: () => ipcRenderer.invoke('architect:projects'),
  open: (root) => ipcRenderer.invoke('architect:open', root),
  pending: () => ipcRenderer.invoke('architect:pending'),
  decide: (id, approved, reason, component) => ipcRenderer.invoke('architect:decide', id, approved, reason, component),
  move: (id, x, y) => ipcRenderer.invoke('architect:move', id, x, y),
  onChange: (fn: (a: Architecture) => void) => {
    ipcRenderer.on('architect:change', (_event, architecture: Architecture) => fn(architecture))
  },
  onPending: (fn: (p: Pending[]) => void) => {
    ipcRenderer.on('architect:pending-update', (_event, pending: Pending[]) => fn(pending))
  },
}

contextBridge.exposeInMainWorld('architect', architect)
