import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Architecture, ArchitectApi, Edit, Pending, Proposal } from '../shared/types'
import App from './App'
import './index.css'

declare global {
  interface Window {
    architect: ArchitectApi
  }
}

function installMock() {
  const roots = {
    '/Users/demo/code/reporter/bot': 'Architecture',
    '/Users/demo/code/reporter/dashboard': 'Architecture'
  }

  const architectures: Record<string, Architecture> = {
    '/Users/demo/code/reporter/bot': {
      title: 'Architecture',
      summary: 'A small service split into API, database access and background workers.',
      components: [
        { id: 'ui', purpose: 'Browser client', owns: ['src/ui/**'] },
        { id: 'api', purpose: 'HTTP API layer', owns: ['src/api/**'] },
        {
          id: 'db',
          purpose:
            'Buckets fetched records by their own createdAt hour and computes the rolling counts every reader depends on. It owns every migration, every prepared statement and the connection pool, so nothing else in the tree may open a socket to Postgres. Reads go through a replica when one is configured, writes never do.',
          owns: ['src/db/**', 'migrations/*.sql', 'scripts/seed/*.ts', 'shared/queries/**']
        },
        { id: 'worker', purpose: 'Background jobs', owns: ['src/worker/**'] }
      ],
      edges: [
        { from: 'ui', to: 'api' },
        { from: 'api', to: 'db' },
        { from: 'worker', to: 'db' }
      ],
      forbidden: [{ from: 'db', to: 'api', reason: 'db must not depend on api' }],
      packages: ['express', 'pg']
    },
    '/Users/demo/code/reporter/dashboard': {
      title: 'Architecture',
      summary: 'Empty scaffold, nothing drawn yet.',
      components: [],
      edges: [],
      forbidden: [],
      packages: []
    }
  }

  const pendingByRoot: Record<string, Pending[]> = {
    '/Users/demo/code/reporter/bot': [
      {
        id: 'p1',
        projectRoot: '/Users/demo/code/reporter/bot',
        proposal: { kind: 'component', id: 'cache', purpose: 'Redis cache layer', owns: ['src/cache/**'] },
        rationale: 'Repeated db reads on hot paths need caching.',
        createdAt: Date.now() - 60_000
      },
      {
        id: 'p2',
        projectRoot: '/Users/demo/code/reporter/bot',
        proposal: { kind: 'edge', from: 'db', to: 'api' },
        rationale: 'db needs to call back into the api client for notifications.',
        createdAt: Date.now() - 50_000
      },
      {
        id: 'p3',
        projectRoot: '/Users/demo/code/reporter/bot',
        proposal: { kind: 'package', name: 'zod', component: 'api' },
        rationale: 'Request validation at the boundary.',
        createdAt: Date.now() - 40_000
      },
      {
        id: 'p4',
        projectRoot: '/Users/demo/code/reporter/bot',
        proposal: { kind: 'file', path: 'src/api/routes/users.ts', component: 'api' },
        rationale: 'New route file for the users resource.',
        createdAt: Date.now() - 30_000
      },
      {
        id: 'p5',
        projectRoot: '/Users/demo/code/reporter/bot',
        proposal: { kind: 'file', path: 'src/legacy/old.ts', component: 'legacy' },
        rationale: 'Migrated file with no clear owner yet.',
        createdAt: Date.now() - 20_000
      },
      {
        id: 'p6',
        projectRoot: '/Users/demo/code/reporter/bot',
        proposal: { kind: 'edge', from: 'ghost-comp', to: 'api' },
        rationale: 'Stale proposal referencing a component that was since removed.',
        createdAt: Date.now() - 10_000
      }
    ],
    '/Users/demo/code/reporter/dashboard': []
  }

  const editsByRoot: Record<string, Edit[]> = {
    '/Users/demo/code/reporter/bot': [],
    '/Users/demo/code/reporter/dashboard': []
  }
  let editCounter = 0

  function findEdit(root: string, id: string): Edit {
    const edit = editsByRoot[root]?.find((e) => e.id === id)
    if (!edit) throw new Error(`no such edit: ${id}`)
    return edit
  }

  const changeListeners = new Set<(a: Architecture) => void>()
  const pendingListeners = new Set<(p: Pending[]) => void>()

  function apply(root: string, proposal: Proposal) {
    const arch = architectures[root]
    if (!arch) return
    if (proposal.kind === 'component') {
      arch.components.push({
        id: proposal.id,
        purpose: proposal.purpose,
        owns: proposal.owns
      })
    } else if (proposal.kind === 'edge') {
      arch.edges.push({ from: proposal.from, to: proposal.to })
    } else if (proposal.kind === 'package') {
      if (!arch.packages.includes(proposal.name)) arch.packages.push(proposal.name)
    }
    changeListeners.forEach((fn) => fn(arch))
  }

  window.architect = {
    async projects() {
      return Object.entries(roots).map(([root, title]) => ({ root, title }))
    },
    async open(root) {
      const arch = architectures[root]
      if (!arch) throw new Error(`unknown project: ${root}`)
      return arch
    },
    async pending() {
      return pendingByRoot['/Users/demo/code/reporter/bot'] ?? []
    },
    async mcpBridgeInfo() {
      return { path: '/Users/demo/.architect/bin/architect-mcp.mjs', exists: true }
    },
    async decide(id, approved, reason, component) {
      for (const root of Object.keys(pendingByRoot)) {
        const list = pendingByRoot[root]
        if (!list) continue
        const index = list.findIndex((p) => p.id === id)
        if (index === -1) continue
        const [item] = list.splice(index, 1)
        if (item && approved) {
          const proposal =
            item.proposal.kind === 'file' && component
              ? { ...item.proposal, component }
              : item.proposal
          apply(root, proposal)
        }
        pendingListeners.forEach((fn) => fn(list))
        return
      }
      void reason
    },
    async edits(root) {
      return (editsByRoot[root] ?? []).map(({ id, status, architecture }) => ({
        id,
        status,
        title: architecture.title
      }))
    },
    async edit(root, id) {
      return findEdit(root, id)
    },
    async createEdit(root, architecture) {
      const list = editsByRoot[root]
      if (!list) throw new Error(`unknown project: ${root}`)
      editCounter += 1
      const edit: Edit = { id: `e${editCounter}`, status: 'draft', architecture }
      list.push(edit)
      return edit
    },
    async updateEdit(root, id, architecture) {
      const edit = findEdit(root, id)
      if (edit.status === 'handed') throw new Error(`edit ${id} was already handed over and can no longer be edited`)
      edit.architecture = architecture
      return edit
    },
    async handEdit(root, id) {
      const edit = findEdit(root, id)
      if (edit.status === 'handed') throw new Error(`edit ${id} was already handed over`)
      edit.status = 'handed'
      return edit
    },
    async deleteEdit(root, id) {
      const list = editsByRoot[root] ?? []
      list.splice(list.indexOf(findEdit(root, id)), 1)
    },
    onChange(fn) {
      changeListeners.add(fn)
    },
    onPending(fn) {
      pendingListeners.add(fn)
    },
    onProjects(fn) {
      fn(Object.entries(roots).map(([root, title]) => ({ root, title })))
    }
  }
}

if (!window.architect) installMock()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
