import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import {
  PROPOSAL_TIMEOUT_MS,
  SOCKET_PATH,
  type Architecture,
  type Decision,
  type Pending,
  type Proposal,
  type Request,
  type Response,
} from '../shared/types'
import { apply, check, parse, serialize } from './graph'

type Waiter = { resolve: (decision: Decision) => void; timer: ReturnType<typeof setTimeout> }

type PendingEntry = { pending: Pending; waiters: Set<Waiter> }

type ProjectState = {
  root: string
  architecture: Architecture
  watcher: FSWatcher
  lastWrittenContent: string | null
}

type DaemonOptions = { socketPath?: string; proposalTimeoutMs?: number }

export function createDaemon(options: DaemonOptions = {}) {
  const socketPath = options.socketPath ?? process.env.ARCHITECT_SOCKET ?? SOCKET_PATH
  const proposalTimeoutMs = options.proposalTimeoutMs ?? PROPOSAL_TIMEOUT_MS

  const projects = new Map<string, ProjectState>()
  const pending = new Map<string, PendingEntry>()
  let activeRoot: string | null = null
  let changeListener: ((a: Architecture) => void) | null = null
  let pendingListener: ((p: Pending[]) => void) | null = null
  let server: net.Server | null = null

  function architectMdPath(root: string) {
    return path.join(root, 'architect.md')
  }

  function notifyPending() {
    pendingListener?.([...pending.values()].map((e) => e.pending))
  }

  function resolveRoot(cwd: string): string | null {
    let dir = path.resolve(cwd)
    while (true) {
      if (fs.existsSync(architectMdPath(dir))) return dir
      const parent = path.dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  }

  function loadProject(root: string): ProjectState {
    const existing = projects.get(root)
    if (existing) return existing

    const filePath = architectMdPath(root)
    const architecture = parse(fs.readFileSync(filePath, 'utf8'))
    const state: ProjectState = {
      root,
      architecture,
      lastWrittenContent: null,
      watcher: null as unknown as FSWatcher,
    }

    const watcher = chokidar.watch(filePath, {
      ignoreInitial: true,
      usePolling: true,
      interval: 30,
      awaitWriteFinish: { stabilityThreshold: 20, pollInterval: 10 },
    })
    watcher.on('change', () => {
      let content: string
      try {
        content = fs.readFileSync(filePath, 'utf8')
      } catch {
        return
      }

      if (content === state.lastWrittenContent) return

      try {
        state.architecture = parse(content)
      } catch (err) {
        console.error(`architect.md parse error in ${root}:`, err instanceof Error ? err.message : err)
        return
      }

      if (state.root === activeRoot) changeListener?.(state.architecture)
    })
    state.watcher = watcher

    projects.set(root, state)
    return state
  }

  function sameProposal(a: Proposal, b: Proposal): boolean {
    if (a.kind !== b.kind) return false
    if (a.kind === 'component' && b.kind === 'component') return a.id === b.id
    if (a.kind === 'edge' && b.kind === 'edge') return a.from === b.from && a.to === b.to
    if (a.kind === 'package' && b.kind === 'package') return a.name === b.name && a.component === b.component
    if (a.kind === 'file' && b.kind === 'file') return a.path === b.path && a.component === b.component
    return false
  }

  function findPendingEntry(root: string, proposal: Proposal): PendingEntry | undefined {
    for (const entry of pending.values()) {
      if (entry.pending.projectRoot === root && sameProposal(entry.pending.proposal, proposal)) return entry
    }
    return undefined
  }

  function waitForDecision(
    entry: PendingEntry,
    id: string,
    registerCancel: (cancel: () => void) => void,
  ): Promise<Decision> {
    return new Promise((resolve) => {
      function cleanup() {
        clearTimeout(waiter.timer)
        entry.waiters.delete(waiter)
      }
      const waiter: Waiter = {
        resolve: (decision) => {
          cleanup()
          resolve(decision)
        },
        timer: setTimeout(() => {
          cleanup()
          resolve({ status: 'pending', id })
        }, proposalTimeoutMs),
      }
      entry.waiters.add(waiter)
      registerCancel(() => {
        cleanup()
        resolve({ status: 'pending', id })
      })
    })
  }

  function proposeChange(
    root: string,
    proposal: Proposal,
    rationale: string,
    registerCancel: (cancel: () => void) => void,
  ): Promise<Decision> {
    loadProject(root)
    let entry = findPendingEntry(root, proposal)
    if (!entry) {
      const id = randomUUID()
      entry = { pending: { id, projectRoot: root, proposal, rationale, createdAt: Date.now() }, waiters: new Set() }
      pending.set(id, entry)
      notifyPending()
    }
    return waitForDecision(entry, entry.pending.id, registerCancel)
  }

  function awaitProposal(proposalId: string, registerCancel: (cancel: () => void) => void): Promise<Decision> {
    const entry = pending.get(proposalId)
    if (!entry) return Promise.reject(new Error(`no pending proposal: ${proposalId}`))
    return waitForDecision(entry, proposalId, registerCancel)
  }

  function resolveWaiters(entry: PendingEntry, decision: Decision) {
    for (const waiter of [...entry.waiters]) {
      clearTimeout(waiter.timer)
      waiter.resolve(decision)
    }
  }

  async function decide(id: string, approved: boolean, reason?: string, component?: string): Promise<void> {
    const entry = pending.get(id)
    if (!entry) return

    const project = projects.get(entry.pending.projectRoot)

    if (approved && project) {
      let proposal = entry.pending.proposal
      if (component && proposal.kind === 'file') proposal = { ...proposal, component }

      try {
        const next = apply(project.architecture, proposal)
        const content = serialize(next)
        project.lastWrittenContent = content
        fs.writeFileSync(architectMdPath(project.root), content)
        project.architecture = next
        if (project.root === activeRoot) changeListener?.(next)
        resolveWaiters(entry, { status: 'approved' })
      } catch (err) {
        resolveWaiters(entry, { status: 'rejected', reason: err instanceof Error ? err.message : String(err) })
      }
    } else {
      resolveWaiters(entry, { status: 'rejected', reason: reason ?? '' })
    }

    pending.delete(id)
    notifyPending()
  }

  async function move(id: string, x: number, y: number): Promise<void> {
    if (!activeRoot) return
    const project = projects.get(activeRoot)
    if (!project) return
    const target = project.architecture.components.find((c) => c.id === id)
    if (!target) return
    target.position = { x, y }
    const content = serialize(project.architecture)
    project.lastWrittenContent = content
    fs.writeFileSync(architectMdPath(project.root), content)
  }

  async function open(root: string): Promise<Architecture> {
    const state = loadProject(root)
    activeRoot = root
    return state.architecture
  }

  function handleConnection(socket: net.Socket) {
    let buf = ''
    const cancels = new Set<() => void>()

    async function handleRequest(req: Request): Promise<Response> {
      try {
        if (req.op === 'get_architecture') {
          const root = resolveRoot(req.cwd)
          if (!root) return { id: req.id, ok: false, error: `no architecture defined for ${req.cwd}` }
          return { id: req.id, ok: true, result: loadProject(root).architecture }
        }

        if (req.op === 'check_change') {
          const root = resolveRoot(req.cwd)
          if (!root) return { id: req.id, ok: false, error: `no architecture defined for ${req.cwd}` }
          return { id: req.id, ok: true, result: check(loadProject(root).architecture, req.from, req.to) }
        }

        if (req.op === 'propose_change') {
          const root = resolveRoot(req.cwd)
          if (!root) return { id: req.id, ok: false, error: `no architecture defined for ${req.cwd}` }
          const decision = await proposeChange(root, req.proposal, req.rationale, (cancel) => cancels.add(cancel))
          return { id: req.id, ok: true, result: decision }
        }

        const decision = await awaitProposal(req.proposalId, (cancel) => cancels.add(cancel))
        return { id: req.id, ok: true, result: decision }
      } catch (err) {
        return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    async function handleLine(line: string) {
      const req = JSON.parse(line) as Request
      const res = await handleRequest(req)
      try {
        socket.write(`${JSON.stringify(res)}\n`)
      } catch {
        return
      }
    }

    socket.on('data', (chunk) => {
      buf += chunk.toString()
      let idx: number
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (line) void handleLine(line)
      }
    })

    socket.on('close', () => {
      for (const cancel of cancels) cancel()
      cancels.clear()
    })

    socket.on('error', () => {})
  }

  function probeLive(target: string): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = net.createConnection(target)
      probe.once('connect', () => {
        probe.destroy()
        resolve(true)
      })
      probe.once('error', () => resolve(false))
    })
  }

  async function listen(): Promise<void> {
    if (process.platform !== 'win32') {
      fs.mkdirSync(path.dirname(socketPath), { recursive: true })
      if (fs.existsSync(socketPath)) {
        const live = await probeLive(socketPath)
        if (live) throw new Error(`architect daemon already running at ${socketPath}`)
        fs.unlinkSync(socketPath)
      }
    }
    return new Promise((resolve, reject) => {
      server = net.createServer(handleConnection)
      server.once('error', (err) => {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EADDRINUSE') reject(new Error(`architect daemon already running at ${socketPath}`))
        else reject(err)
      })
      server.listen(socketPath, () => resolve())
    })
  }

  function close(): Promise<void> {
    for (const project of projects.values()) void project.watcher.close()
    return new Promise((resolve) => {
      if (!server) return resolve()
      server.close(() => resolve())
    })
  }

  return {
    listen,
    close,
    projects: () => [...projects.values()].map((p) => ({ root: p.root, title: p.architecture.title })),
    open,
    pending: () => [...pending.values()].map((e) => e.pending),
    decide,
    move,
    onChange: (fn: (a: Architecture) => void) => {
      changeListener = fn
    },
    onPending: (fn: (p: Pending[]) => void) => {
      pendingListener = fn
    },
  }
}
