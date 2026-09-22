import type { Architecture, ArchitectApi, CodeMap, Edit, FunctionEntry, Ownership, Pending, Proposal } from '../../shared/types'

declare global {
  interface Window {
    architect: ArchitectApi
  }
}

export function installMock() {
  const roots = {
    '/Users/demo/code/architect': 'Architecture',
    '/Users/demo/code/architect-docs': 'Architecture'
  }

  const architectures: Record<string, Architecture> = {
    '/Users/demo/code/architect': {
      title: 'Architecture',
      summary: 'A small service split into API, database access and background workers.',
      components: [
        { id: 'ui', purpose: 'Browser client', owns: ['src/ui/**'] },
        { id: 'api', purpose: 'HTTP API layer', owns: ['src/api/**'] },
        {
          id: 'db',
          purpose: 'Postgres access layer',
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
    '/Users/demo/code/architect-docs': {
      title: 'Architecture',
      summary: 'Empty scaffold, nothing drawn yet.',
      components: [],
      edges: [],
      forbidden: [],
      packages: []
    }
  }

  const pendingByRoot: Record<string, Pending[]> = {
    '/Users/demo/code/architect': [
      {
        id: 'p1',
        projectRoot: '/Users/demo/code/architect',
        proposal: { kind: 'component', id: 'cache', purpose: 'Redis cache layer', owns: ['src/cache/**'] },
        rationale: 'Repeated db reads on hot paths need caching.',
        createdAt: Date.now() - 60_000
      },
      {
        id: 'p2',
        projectRoot: '/Users/demo/code/architect',
        proposal: { kind: 'edge', from: 'db', to: 'api' },
        rationale: 'db needs to call back into the api client for notifications.',
        createdAt: Date.now() - 50_000
      },
      {
        id: 'p3',
        projectRoot: '/Users/demo/code/architect',
        proposal: { kind: 'package', name: 'zod', component: 'api' },
        rationale: 'Request validation at the boundary.',
        createdAt: Date.now() - 40_000
      },
      {
        id: 'p4',
        projectRoot: '/Users/demo/code/architect',
        proposal: { kind: 'file', path: 'src/api/routes/users.ts', component: 'api' },
        rationale: 'New route file for the users resource.',
        createdAt: Date.now() - 30_000
      },
      {
        id: 'p5',
        projectRoot: '/Users/demo/code/architect',
        proposal: { kind: 'file', path: 'src/legacy/old.ts', component: 'legacy' },
        rationale: 'Migrated file with no clear owner yet.',
        createdAt: Date.now() - 20_000
      },
      {
        id: 'p6',
        projectRoot: '/Users/demo/code/architect',
        proposal: { kind: 'edge', from: 'ghost-comp', to: 'api' },
        rationale: 'Stale proposal referencing a component that was since removed.',
        createdAt: Date.now() - 10_000
      }
    ],
    '/Users/demo/code/architect-docs': []
  }

  const editsByRoot: Record<string, Edit[]> = {
    '/Users/demo/code/architect': [],
    '/Users/demo/code/architect-docs': []
  }
  let editCounter = 0

  function findEdit(root: string, id: string): Edit {
    const edit = editsByRoot[root]?.find((e) => e.id === id)
    if (!edit) throw new Error(`no such edit: ${id}`)
    return edit
  }

  type Draft = Omit<FunctionEntry, 'calls'> & { calls: (string | number)[] }

  type DraftMap = {
    root: string
    scannedAt: number
    folders: { path: string; folders: string[]; files: { path: string; functions: Draft[] }[] }[]
  }

  function fn(
    name: string,
    line: number,
    endLine: number,
    description: string,
    calls: (string | number)[] = []
  ): Draft {
    return { name, line, endLine, description, calls }
  }

  function indexed(draft: DraftMap): CodeMap {
    return {
      ...draft,
      folders: draft.folders.map((folder) => ({
        ...folder,
        files: folder.files.map((file) => ({
          ...file,
          functions: file.functions.map((entry) => ({
            ...entry,
            calls: entry.calls.flatMap((call) => {
              const at = typeof call === 'number' ? call : file.functions.findIndex((other) => other.name === call)
              return at < 0 || !file.functions[at] ? [] : [{ file: file.path, fn: at }]
            })
          }))
        }))
      }))
    }
  }

  function mockCodeMap(root: string): CodeMap {
    return indexed({
      root,
      scannedAt: Date.now(),
      folders: [
        {
          path: '',
          folders: ['src', 'electron', 'mcp', 'docs'],
          files: [
            {
              path: 'index.ts',
              functions: [fn('main', 1, 14, 'Boots the process and hands control to the app shell.')]
            },
            { path: 'vite.config.ts', functions: [] },
            { path: 'package.json', functions: [] },
            { path: 'README.md', functions: [] }
          ]
        },
        {
          path: 'docs',
          folders: ['docs/img'],
          files: [
            { path: 'docs/guide.md', functions: [] },
            { path: 'docs/changelog.md', functions: [] }
          ]
        },
        {
          path: 'docs/img',
          folders: [],
          files: [{ path: 'docs/img/hero.svg', functions: [] }]
        },
        {
          path: 'src',
          folders: ['src/workflows', 'src/ui'],
          files: [
            {
              path: 'src/App.tsx',
              functions: [
                fn('App', 25, 96, 'Holds every screen level state and wires the sidebar to the canvas.', ['placeholderId', 'describe']),
                fn('placeholderId', 10, 15, 'Picks the next unused component id.'),
                fn('describe', 17, 23, '')
              ]
            },
            {
              path: 'src/layout.ts',
              functions: [
                fn('findCycleEdges', 22, 51, 'Walks the edge list backwards to find the path that would close a cycle.'),
                fn('hasCycle', 53, 55, 'True when adding this edge would close a cycle.', ['findCycleEdges']),
                fn('statusOf', 57, 61, 'The badge word shown on a node.'),
                fn('folderName', 63, 66, 'Last path segment of a project root.'),
                fn('roleOf', 68, 74, 'Classifies a component as entry, foundation or middle.'),
                fn('sides', 76, 81, ''),
                fn('packageBadges', 83, 90, 'Pending package proposals attached to one component.'),
                fn('build', 92, 175, 'Turns an architecture plus its pending proposals into nodes and links.', ['roleOf', 'packageBadges', 'hasCycle', 'statusOf']),
                fn('positions', 177, 184, 'Runs dagre and returns a top left point per node.', ['anchorTop', 'anchorBottom']),
                fn('anchorTop', 186, 189, 'Pins entry points to the first rank.'),
                fn('anchorBottom', 191, 194, 'Pins foundations to the last rank.')
              ]
            },
            {
              path: 'src/parse.ts',
              functions: [
                fn('parse', 3, 3, ''),
                fn('parse', 4, 4, ''),
                fn('parse', 6, 18, 'Turns raw text into the tree every reader walks.'),
                fn('main', 20, 30, 'Reads the argument and hands it to the parser.', [2]),
                fn('outer', 32, 40, 'Walks one tree with its own visitor.', [5]),
                fn('visit', 34, 36, 'Visits one node for outer.'),
                fn('other', 42, 50, 'Walks another tree with its own visitor.', [7]),
                fn('visit', 44, 46, 'Visits one node for other.'),
                fn('render', 60, 560, 'Draws the whole report, one block per parsed node.')
              ]
            },
            { path: 'src/types.ts', functions: [] }
          ]
        },
        {
          path: 'src/workflows',
          folders: [],
          files: [
            {
              path: 'src/workflows/runner.ts',
              functions: [
                fn('run', 8, 34, 'Executes one workflow step and persists the result.', ['validate', 'load', 'execute', 'persist']),
                fn('validate', 38, 46, 'Rejects a run whose input does not match the step schema.'),
                fn('load', 50, 62, 'Reads the stored run record, falling back to a fresh one.', ['cacheKey']),
                fn('execute', 66, 92, 'Drives the step body and decides whether to retry it.', ['step', 'retry']),
                fn('step', 96, 108, 'Runs exactly one attempt of the step body.', ['cacheKey']),
                fn('retry', 112, 130, 'Backs off and tries the step again until the budget runs out.', ['retry', 'step']),
                fn('persist', 134, 150, 'Writes the run result back to storage.', ['cacheKey']),
                fn('cacheKey', 154, 160, 'Stable key for one run of one step.'),
                fn('report', 164, 352, 'Renders the full run report, one section per attempt, for the operator console.'),
                fn('noop', 356, 358, '')
              ]
            },
            {
              path: 'src/workflows/queue.ts',
              functions: [
                fn('push', 4, 17, 'Appends a job and wakes a sleeping worker.', ['wake']),
                fn('wake', 19, 28, 'Signals one idle worker that there is work.'),
                fn('drain', 30, 48, 'Pops jobs until the queue is empty.', ['push'])
              ]
            }
          ]
        },
        {
          path: 'src/ui',
          folders: ['src/ui/panels'],
          files: [
            {
              path: 'src/ui/Button.tsx',
              functions: [fn('Button', 3, 21, 'The only button in the app, themed from custom properties.')]
            }
          ]
        },
        {
          path: 'src/ui/panels',
          folders: [],
          files: [
            {
              path: 'src/ui/panels/Inspector.tsx',
              functions: [
                fn('Inspector', 13, 60, 'Side panel for the selected node.', ['commit', 'blurOnEnter', 'drop']),
                fn('commit', 19, 24, 'Applies one edit operation and forces a rerender.'),
                fn('blurOnEnter', 25, 28, ''),
                fn('drop', 29, 34, 'Confirms, then deletes the component and its edges.', ['commit'])
              ]
            }
          ]
        },
        {
          path: 'electron',
          folders: [],
          files: [
            {
              path: 'electron/main.ts',
              functions: [
                fn('createWindow', 12, 38, 'Opens the single browser window and loads the renderer.'),
                fn('registerIpc', 40, 64, 'Binds every renderer channel to a store call.', ['openProject', 'scanCode']),
                fn('watchProjects', 66, 86, 'Reloads an architecture when its file changes on disk.', ['openProject']),
                fn('quit', 88, 93, ''),
                fn('openProject', 95, 118, 'Reads one project root and caches its architecture.'),
                fn('scanCode', 120, 168, 'Walks the repo and asks the model to describe each function.')
              ]
            },
            {
              path: 'electron/preload.ts',
              functions: [
                fn('expose', 6, 20, 'Publishes the architect API on the window object.', ['invoke']),
                fn('invoke', 22, 30, '')
              ]
            }
          ]
        },
        {
          path: 'mcp',
          folders: [],
          files: [
            {
              path: 'mcp/server.ts',
              functions: [
                fn('getArchitecture', 14, 30, 'Returns the current architecture for a working directory.', ['send']),
                fn('checkChange', 32, 49, 'Answers whether one component may depend on another.', ['send']),
                fn('proposeChange', 51, 72, 'Queues a proposal for human approval.', ['send']),
                fn('awaitProposal', 74, 94, 'Blocks until the human approves or rejects.', ['send']),
                fn('listEdits', 96, 110, 'Every draft and handed edit for a project.', ['send']),
                fn('getEdit', 112, 128, 'One edit by id.', ['send']),
                fn('connect', 130, 146, 'Opens the unix socket to the desktop app.'),
                fn('send', 148, 168, '', ['connect']),
                fn('main', 170, 186, 'Starts the stdio transport.', ['getArchitecture', 'checkChange', 'proposeChange', 'awaitProposal', 'listEdits', 'getEdit'])
              ]
            }
          ]
        }
      ]
    })
  }

  function mockFileText(root: string, path: string): string {
    const entry = mockCodeMap(root).folders.flatMap((f) => f.files).find((f) => f.path === path)
    if (!entry) return ''

    const lines: string[] = []
    for (const f of entry.functions) {
      while (lines.length < f.line - 1) lines.push('')
      const body = Math.max(0, f.endLine - f.line - 1)
      lines.push(`export function ${f.name}(input: Input, options: Options = {}): Result {`)
      for (let i = 0; i < body; i += 1) {
        const at = f.calls[i % Math.max(1, f.calls.length)]
        const call = at === undefined ? undefined : entry.functions[at.fn]?.name
        if (i % 5 === 4) {
          lines.push(
            `      const merged = await gather(input.records.filter((r) => r.active && r.owner === options.owner), { retries: 3, timeout: 15000, label: 'attempt ${i}' })`
          )
          continue
        }

        lines.push(
          call && i % 3 === 0
            ? `  const step${i} = ${call}(input, { ...options, attempt: ${i} })`
            : `  if (!input.ready) return { ok: false, at: ${f.line + i + 1}, reason: 'not ready yet' }`
        )
      }
      if (f.endLine > f.line) lines.push('}')
    }
    return lines.join('\n')
  }

  const codeMaps: Record<string, CodeMap> = {
    '/Users/demo/code/architect': mockCodeMap('/Users/demo/code/architect')
  }

  const ownerships: Record<string, Ownership> = {
    '/Users/demo/code/architect': {
      owned: [
        { path: 'src/api/routes.ts', owner: 'api' },
        { path: 'src/db/client.ts', owner: 'db' },
        { path: 'src/ui/App.tsx', owner: 'ui' },
        { path: 'src/worker/queue.ts', owner: 'worker' }
      ],
      unowned: ['README.md', 'src/index.ts'],
      multi: [{ path: 'src/db/schema.ts', owners: ['api', 'db'] }],
      dead: [{ component: 'db', pattern: 'scripts/seed/*.ts' }]
    }
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
      return pendingByRoot['/Users/demo/code/architect'] ?? []
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
        pendingListeners.forEach((fn) => fn([...list]))
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
    async getCodeMap(root) {
      return codeMaps[root] ?? null
    },
    async readSource(root, file, from, length) {
      const lines = mockFileText(root, file).split('\n')
      if (lines.at(-1) === '') lines.pop()
      const start = Math.max(1, from)
      const span = Math.min(400, Math.max(0, length))

      return { from: start, lines: lines.slice(start - 1, start - 1 + span), total: lines.length, error: null }
    },
    async ownership(root) {
      return ownerships[root] ?? null
    },
    async rescan(root) {
      const scanned = mockCodeMap(root)
      codeMaps[root] = scanned
      return scanned
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
