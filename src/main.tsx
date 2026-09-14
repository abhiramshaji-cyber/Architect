import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Architecture, Pending, Proposal } from '../shared/types'
import App from './App'
import './index.css'

declare global {
  interface Window {
    architect: {
      projects(): Promise<{ root: string; title: string }[]>
      open(root: string): Promise<Architecture>
      pending(): Promise<Pending[]>
      decide(id: string, approved: boolean, reason?: string): Promise<void>
      move(id: string, x: number, y: number): Promise<void>
      onChange(fn: (a: Architecture) => void): void
      onPending(fn: (p: Pending[]) => void): void
    }
  }
}

function installMock() {
  const roots = {
    '/demo/project-alpha': 'Project Alpha',
    '/demo/project-beta': 'Project Beta'
  }

  const architectures: Record<string, Architecture> = {
    '/demo/project-alpha': {
      title: 'Project Alpha',
      summary: 'A small service split into API, database access and background workers.',
      components: [
        { id: 'api', purpose: 'HTTP API layer', owns: ['src/api/**'], position: { x: 80, y: 80 } },
        { id: 'db', purpose: 'Database access', owns: ['src/db/**'], position: { x: 440, y: 80 } },
        { id: 'worker', purpose: 'Background jobs', owns: ['src/worker/**'], position: { x: 260, y: 320 } }
      ],
      edges: [
        { from: 'api', to: 'db' },
        { from: 'worker', to: 'db' }
      ],
      forbidden: [{ from: 'db', to: 'api', reason: 'db must not depend on api' }],
      packages: ['express', 'pg']
    },
    '/demo/project-beta': {
      title: 'Project Beta',
      summary: 'Empty scaffold, nothing drawn yet.',
      components: [],
      edges: [],
      forbidden: [],
      packages: []
    }
  }

  const pendingByRoot: Record<string, Pending[]> = {
    '/demo/project-alpha': [
      {
        id: 'p1',
        projectRoot: '/demo/project-alpha',
        proposal: { kind: 'component', id: 'cache', purpose: 'Redis cache layer', owns: ['src/cache/**'] },
        rationale: 'Repeated db reads on hot paths need caching.',
        createdAt: Date.now() - 60_000
      },
      {
        id: 'p2',
        projectRoot: '/demo/project-alpha',
        proposal: { kind: 'edge', from: 'db', to: 'api' },
        rationale: 'db needs to call back into the api client for notifications.',
        createdAt: Date.now() - 50_000
      },
      {
        id: 'p3',
        projectRoot: '/demo/project-alpha',
        proposal: { kind: 'package', name: 'zod', component: 'api' },
        rationale: 'Request validation at the boundary.',
        createdAt: Date.now() - 40_000
      },
      {
        id: 'p4',
        projectRoot: '/demo/project-alpha',
        proposal: { kind: 'file', path: 'src/api/routes/users.ts' },
        rationale: 'New route file for the users resource.',
        createdAt: Date.now() - 30_000
      },
      {
        id: 'p5',
        projectRoot: '/demo/project-alpha',
        proposal: { kind: 'file', path: 'src/legacy/old.ts' },
        rationale: 'Migrated file with no clear owner yet.',
        createdAt: Date.now() - 20_000
      },
      {
        id: 'p6',
        projectRoot: '/demo/project-alpha',
        proposal: { kind: 'edge', from: 'ghost-comp', to: 'api' },
        rationale: 'Stale proposal referencing a component that was since removed.',
        createdAt: Date.now() - 10_000
      }
    ],
    '/demo/project-beta': []
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
        owns: proposal.owns,
        position: { x: 260, y: 80 }
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
      return pendingByRoot['/demo/project-alpha'] ?? []
    },
    async decide(id, approved, reason) {
      for (const root of Object.keys(pendingByRoot)) {
        const list = pendingByRoot[root]
        if (!list) continue
        const index = list.findIndex((p) => p.id === id)
        if (index === -1) continue
        const [item] = list.splice(index, 1)
        if (item && approved) apply(root, item.proposal)
        pendingListeners.forEach((fn) => fn(list))
        return
      }
      void reason
    },
    async move(id, x, y) {
      for (const arch of Object.values(architectures)) {
        const component = arch.components.find((c) => c.id === id)
        if (component) {
          component.position = { x, y }
          changeListeners.forEach((fn) => fn(arch))
          return
        }
      }
    },
    onChange(fn) {
      changeListeners.add(fn)
    },
    onPending(fn) {
      pendingListeners.add(fn)
    }
  }
}

if (!window.architect) installMock()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
