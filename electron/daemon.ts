import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { SOCKET_PATH } from '../shared/socket'
import {
  PROPOSAL_TIMEOUT_MS,
  type Architecture,
  type CodeMap,
  type ContractState,
  type Decision,
  type Edit,
  type EditSummary,
  type OpenedProject,
  type Ownership,
  type Pending,
  pendingSchema,
  type ProjectSummary,
  type Proposal,
  requestSchema,
  type Request,
  type Response,
  type SourceWindow,
  type Verdict,
} from '../shared/types'
import { describe, type DescriptionCache } from './scan/describe'
import { createEdit, deleteEdit, handEdit, listEdits, readEdit, updateEdit } from './contract/edits'
import { apply, check, ownership, parse, serialize } from './contract/graph'
import { IGNORED_DIRS, scan } from './scan/scan'

const MAP_VERSION = 3

function mapPath(root: string) {
  return path.join(root, '.architect', 'map.json')
}

function isCallRef(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const ref = value as Record<string, unknown>
  return typeof ref.file === 'string' && Number.isInteger(ref.fn)
}

function isFunctionEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const fn = value as Record<string, unknown>
  if (!Array.isArray(fn.calls) || !fn.calls.every(isCallRef)) return false
  if (typeof fn.endLine !== 'number') return false
  return typeof fn.name === 'string' && typeof fn.line === 'number' && typeof fn.description === 'string'
}

function isFileEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const file = value as Record<string, unknown>
  return typeof file.path === 'string' && Array.isArray(file.functions) && file.functions.every(isFunctionEntry)
}

function isFolderEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const folder = value as Record<string, unknown>
  if (typeof folder.path !== 'string') return false
  if (!Array.isArray(folder.folders) || !folder.folders.every((f) => typeof f === 'string')) return false
  return Array.isArray(folder.files) && folder.files.every(isFileEntry)
}

function isCodeMap(value: unknown): value is CodeMap {
  if (typeof value !== 'object' || value === null) return false
  const map = value as Partial<CodeMap>
  if (typeof map.root !== 'string' || typeof map.scannedAt !== 'number') return false
  return Array.isArray(map.folders) && map.folders.every(isFolderEntry)
}

function readStoredMap(root: string): { map: CodeMap | null; cache: DescriptionCache } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(mapPath(root), 'utf8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const { version, map, cache } = parsed as { version?: unknown; map?: unknown; cache?: unknown }

  const entries =
    typeof cache === 'object' && cache !== null && !Array.isArray(cache)
      ? Object.entries(cache).filter((e): e is [string, string] => typeof e[1] === 'string')
      : []

  const current = version === MAP_VERSION && isCodeMap(map) ? map : null

  return { map: current, cache: Object.fromEntries(entries) }
}

function writeStoredMap(root: string, stored: { map: CodeMap; cache: DescriptionCache }) {
  fs.mkdirSync(path.dirname(mapPath(root)), { recursive: true })
  fs.writeFileSync(mapPath(root), JSON.stringify({ version: MAP_VERSION, ...stored }, null, 2))
}

const MAX_SOURCE_LINES = 400

const RESCAN_DEBOUNCE_MS = 300

function isIgnoredSource(root: string, target: string, stats?: fs.Stats): boolean {
  const relative = path.relative(root, target)
  if (relative === '') return false
  if (relative.startsWith('..')) return true
  if (stats !== undefined && !stats.isFile() && !stats.isDirectory()) return true

  const segments = relative.split(path.sep)
  return segments.some((segment, at) => {
    if (IGNORED_DIRS.has(segment)) return true
    if (segment.startsWith('.')) return at < segments.length - 1 || stats?.isDirectory() === true
    return false
  })
}

type Waiter = { resolve: (decision: Decision) => void; timer: ReturnType<typeof setTimeout> }

type PendingEntry = { pending: Pending; waiters: Set<Waiter> }

type ProjectState = {
  root: string
  architecture: Architecture | null
  contract: ContractState
  watcher: FSWatcher
  sources: FSWatcher
  rescanTimer: ReturnType<typeof setTimeout> | null
  rescanning: boolean
  rescanAgain: boolean
  lastWrittenContent: string | null
}

type DaemonOptions = { socketPath?: string; proposalTimeoutMs?: number; rescanDebounceMs?: number }

function sameContract(a: ContractState, b: ContractState): boolean {
  if (a.status === 'invalid' && b.status === 'invalid') return a.error === b.error
  return a.status === b.status
}

function starterArchitecture(root: string, map: CodeMap): Architecture {
  const tops = new Map<string, { dirs: string[]; owns: string[] }>()

  for (const folder of map.folders) {
    for (const file of folder.files) {
      const [top] = file.path.split('/')
      if (top === undefined || top === file.path) continue

      const id = top.replaceAll('->', '-').replace(/\s+/g, '-')
      const entry = tops.get(id) ?? { dirs: [], owns: [] }
      if (!entry.dirs.includes(top)) {
        entry.dirs.push(top)
        entry.owns.push(`${top}/**`)
      }
      tops.set(id, entry)
    }
  }

  const components = [...tops]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, entry]) => ({ id, purpose: `Code under ${entry.dirs.join(', ')}.`, owns: entry.owns }))

  return {
    title: path.basename(root),
    summary: 'A starter contract from the folders Architect scanned. Say what each component is for and draw the dependencies.',
    components,
    edges: [],
    forbidden: [],
    packages: [],
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function recoverId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

export function createDaemon(options: DaemonOptions = {}) {
  const socketPath = options.socketPath ?? process.env.ARCHITECT_SOCKET ?? SOCKET_PATH
  const proposalTimeoutMs = options.proposalTimeoutMs ?? PROPOSAL_TIMEOUT_MS
  const rescanDebounceMs = options.rescanDebounceMs ?? RESCAN_DEBOUNCE_MS

  const projects = new Map<string, ProjectState>()
  const pending = new Map<string, PendingEntry>()
  let activeRoot: string | null = null
  let changeListener: ((a: Architecture) => void) | null = null
  let pendingListener: ((p: Pending[]) => void) | null = null
  let projectsListener: ((p: ProjectSummary[]) => void) | null = null
  let codeMapListener: ((root: string, map: CodeMap) => void) | null = null
  let server: net.Server | null = null

  async function readSource(
    root: string,
    file: string,
    from: number,
    length: number
  ): Promise<SourceWindow> {
    const start = Math.max(1, Math.floor(from))
    const span = Math.min(MAX_SOURCE_LINES, Math.max(0, Math.floor(length)))
    const empty = { from: start, lines: [], total: 0 }

    if (!projects.has(root)) return { ...empty, error: 'closed' }
    if (!Number.isFinite(from) || !Number.isFinite(length)) return { ...empty, error: 'range' }

    let base: string
    let target: string
    try {
      base = await fs.promises.realpath(root)
      target = await fs.promises.realpath(path.resolve(base, file))
    } catch {
      return { ...empty, error: 'unreadable' }
    }

    if (target !== base && !target.startsWith(base + path.sep)) return { ...empty, error: 'outside' }

    let raw: Buffer
    try {
      raw = await fs.promises.readFile(target)
    } catch {
      return { ...empty, error: 'unreadable' }
    }

    let text: string
    try {
      text = new TextDecoder('utf8', { fatal: true }).decode(raw)
    } catch {
      return { ...empty, error: 'binary' }
    }

    if (text.includes('\u0000')) return { ...empty, error: 'binary' }

    const lines = text.split('\n')
    if (lines.at(-1) === '') lines.pop()

    return { from: start, lines: lines.slice(start - 1, start - 1 + span), total: lines.length, error: null }
  }

  function architectMdPath(root: string) {
    return path.join(root, 'architect.md')
  }

  const statePath = path.join(path.dirname(socketPath), 'projects.json')
  const remembered = new Set<string>()

  function saveProjects() {
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true })
      fs.writeFileSync(statePath, JSON.stringify([...remembered], null, 2))
    } catch (err) {
      console.error('could not persist project list:', err instanceof Error ? err.message : err)
    }
  }

  function restoreProjects() {
    let roots: unknown
    try {
      roots = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    } catch {
      return
    }
    if (!Array.isArray(roots)) return

    for (const root of roots) {
      if (typeof root !== 'string') continue
      remembered.add(root)
      try {
        loadProject(root)
      } catch (err) {
        console.error(`could not open ${root}:`, err instanceof Error ? err.message : err)
      }
    }
    saveProjects()
  }

  const pendingPath = path.join(path.dirname(socketPath), 'pending.json')

  function listPending() {
    return [...pending.values()].map((e) => e.pending)
  }

  function savePending() {
    try {
      fs.mkdirSync(path.dirname(pendingPath), { recursive: true })
      fs.writeFileSync(pendingPath, JSON.stringify(listPending(), null, 2))
    } catch (err) {
      console.error('could not persist pending proposals:', err instanceof Error ? err.message : err)
    }
  }

  function restorePending() {
    let stored: unknown
    try {
      stored = JSON.parse(fs.readFileSync(pendingPath, 'utf8'))
    } catch {
      return
    }
    if (!Array.isArray(stored)) return

    for (const raw of stored) {
      const parsed = pendingSchema.safeParse(raw)
      if (!parsed.success || pending.has(parsed.data.id)) continue
      pending.set(parsed.data.id, { pending: parsed.data, waiters: new Set() })
    }
  }

  function notifyPending() {
    savePending()
    pendingListener?.(listPending())
  }

  function listProjects(): ProjectSummary[] {
    return [...projects.values()].map((p) => ({
      root: p.root,
      title: p.architecture?.title ?? path.basename(p.root),
      contract: p.contract,
    }))
  }

  function notifyProjects() {
    projectsListener?.(listProjects())
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

  async function rescanProject(root: string): Promise<CodeMap> {
    const stored = readStoredMap(root)
    const described = await describe(await scan(root), root, stored?.cache)

    try {
      writeStoredMap(root, described)
    } catch (err) {
      console.error('could not persist code map:', errorText(err))
    }

    return described.map
  }

  function scheduleRescan(state: ProjectState) {
    if (state.rescanTimer) clearTimeout(state.rescanTimer)
    state.rescanTimer = setTimeout(() => {
      state.rescanTimer = null
      void runRescan(state)
    }, rescanDebounceMs)
  }

  async function runRescan(state: ProjectState) {
    if (state.rescanning) {
      state.rescanAgain = true
      return
    }

    state.rescanning = true
    try {
      const map = await rescanProject(state.root)
      if (projects.get(state.root) === state) codeMapListener?.(state.root, map)
    } catch (err) {
      console.error(`could not rescan ${state.root}:`, errorText(err))
    }
    state.rescanning = false

    if (state.rescanAgain && projects.get(state.root) === state) {
      state.rescanAgain = false
      scheduleRescan(state)
    }
  }

  function teardown(state: ProjectState) {
    if (state.rescanTimer) clearTimeout(state.rescanTimer)
    state.rescanTimer = null
    void state.watcher.close()
    void state.sources.close()
  }

  function closeProject(root: string) {
    const state = projects.get(root)
    if (!state) return

    teardown(state)
    projects.delete(root)
    remembered.delete(root)
    saveProjects()

    if (activeRoot === root) activeRoot = null
    notifyProjects()
  }

  function loadProject(root: string): ProjectState {
    const existing = projects.get(root)
    if (existing) return existing
    if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${root} is not a directory`)

    const filePath = architectMdPath(root)
    const state: ProjectState = {
      root,
      architecture: null,
      contract: { status: 'missing' },
      lastWrittenContent: null,
      watcher: null as unknown as FSWatcher,
      sources: null as unknown as FSWatcher,
      rescanTimer: null,
      rescanning: false,
      rescanAgain: false,
    }

    function absorb(content: string) {
      try {
        state.architecture = parse(content)
        state.contract = { status: 'ready' }
      } catch (err) {
        state.contract = { status: 'invalid', error: `${filePath}: ${errorText(err)}` }
      }
    }

    function reread() {
      let content: string
      try {
        content = fs.readFileSync(filePath, 'utf8')
      } catch (err) {
        if (!fs.existsSync(filePath)) {
          state.architecture = null
          state.contract = { status: 'missing' }
          return
        }
        state.contract = { status: 'invalid', error: `could not read ${filePath}: ${errorText(err)}` }
        return
      }

      if (content === state.lastWrittenContent && state.contract.status === 'ready') return
      absorb(content)
    }

    reread()

    const watcher = chokidar.watch(filePath, {
      ignoreInitial: true,
      usePolling: true,
      interval: 30,
      awaitWriteFinish: { stabilityThreshold: 20, pollInterval: 10 },
    })
    watcher.on('all', (event) => {
      if (event !== 'add' && event !== 'change' && event !== 'unlink') return

      const contract = state.contract
      const architecture = state.architecture
      reread()
      if (sameContract(contract, state.contract) && architecture === state.architecture) return

      notifyProjects()
      if (state.root === activeRoot && state.contract.status === 'ready' && state.architecture) {
        changeListener?.(state.architecture)
      }
    })
    state.watcher = watcher

    const sources = chokidar.watch(root, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (target: string, stats?: fs.Stats) => isIgnoredSource(root, target, stats),
    })
    sources.on('all', () => scheduleRescan(state))
    sources.on('error', (err) => console.error(`source watcher for ${root}:`, errorText(err)))
    state.sources = sources

    projects.set(root, state)
    remembered.add(root)
    saveProjects()
    notifyProjects()
    return state
  }

  function reopen(root: string): ProjectState | undefined {
    try {
      return loadProject(root)
    } catch {
      return undefined
    }
  }

  function sameProposal(a: Proposal, b: Proposal): boolean {
    if (a.kind !== b.kind) return false
    if (a.kind === 'component' && b.kind === 'component') return a.id === b.id
    if (a.kind === 'remove_component' && b.kind === 'remove_component') return a.id === b.id
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

    const root = entry.pending.projectRoot
    const project = approved ? reopen(root) : undefined

    const blocked =
      project?.contract.status === 'invalid'
        ? project.contract.error
        : project?.contract.status === 'missing'
          ? `${root} has no architect.md`
          : null

    if (approved && blocked !== null) {
      resolveWaiters(entry, { status: 'rejected', reason: blocked })
    } else if (approved && project && project.architecture) {
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
      resolveWaiters(entry, { status: 'rejected', reason: reason ?? (approved ? `could not open ${root}` : '') })
    }

    pending.delete(id)
    notifyPending()
  }

  async function open(root: string): Promise<OpenedProject> {
    const state = loadProject(root)
    activeRoot = root
    return { contract: state.contract, architecture: state.architecture }
  }

  async function createContract(root: string): Promise<Architecture> {
    const state = loadProject(root)
    if (state.contract.status !== 'missing') throw new Error(`${root} already has an architect.md`)

    const architecture = starterArchitecture(root, readStoredMap(root)?.map ?? (await scan(root)))
    const content = serialize(architecture)
    state.lastWrittenContent = content
    fs.writeFileSync(architectMdPath(root), content)

    state.architecture = architecture
    state.contract = { status: 'ready' }
    notifyProjects()
    if (root === activeRoot) changeListener?.(architecture)
    return architecture
  }

  function verdictFor(architecture: Architecture, parseError: string | null, from: string, to: string): Verdict {
    const verdict = check(architecture, from, to)
    if (parseError === null) return verdict

    const note =
      `the architecture is stale: ${parseError}. ` +
      `This ${verdict.status} verdict comes from the last version of architect.md that parsed ` +
      `and may not match the file on disk. Fix architect.md and check again before relying on it.`

    if (verdict.status === 'forbidden') return { status: 'forbidden', reason: `${verdict.reason} — ${note}` }
    return { status: 'unknown', reason: note }
  }

  function handleConnection(socket: net.Socket) {
    let buf = ''
    const cancels = new Set<() => void>()

    async function handleRequest(req: Request): Promise<Response> {
      try {
        if (req.op === 'get_architecture') {
          const root = resolveRoot(req.cwd)
          if (!root) return { id: req.id, ok: false, error: `no architecture defined for ${req.cwd}` }
          const state = loadProject(root)
          if (state.contract.status === 'invalid') return { id: req.id, ok: false, error: state.contract.error }
          if (!state.architecture) return { id: req.id, ok: false, error: `${root} has no architect.md` }
          return { id: req.id, ok: true, result: state.architecture }
        }

        if (req.op === 'check_change') {
          const root = resolveRoot(req.cwd)
          if (!root) return { id: req.id, ok: false, error: `no architecture defined for ${req.cwd}` }
          const state = loadProject(root)
          const stale = state.contract.status === 'invalid' ? state.contract.error : null
          if (!state.architecture) return { id: req.id, ok: false, error: stale ?? `${root} has no architect.md` }
          return { id: req.id, ok: true, result: verdictFor(state.architecture, stale, req.from, req.to) }
        }

        if (req.op === 'propose_change') {
          const root = resolveRoot(req.cwd)
          if (!root) return { id: req.id, ok: false, error: `no architecture defined for ${req.cwd}` }
          const decision = await proposeChange(root, req.proposal, req.rationale, (cancel) => cancels.add(cancel))
          return { id: req.id, ok: true, result: decision }
        }

        if (req.op === 'await_proposal') {
          const decision = await awaitProposal(req.proposalId, (cancel) => cancels.add(cancel))
          return { id: req.id, ok: true, result: decision }
        }

        const root = resolveRoot(req.cwd)
        if (!root) return { id: req.id, ok: false, error: `no architecture defined for ${req.cwd}` }
        loadProject(root)

        if (req.op === 'list_edits') return { id: req.id, ok: true, result: listEdits(root) }
        return { id: req.id, ok: true, result: readEdit(root, req.editId) }
      } catch (err) {
        return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    function reply(res: Response) {
      try {
        socket.write(`${JSON.stringify(res)}\n`)
      } catch {
        return
      }
    }

    async function handleLine(line: string) {
      let decoded: unknown
      try {
        decoded = JSON.parse(line)
      } catch {
        console.error(`ignoring unparseable socket line (${line.length} bytes)`)
        return
      }

      const parsed = requestSchema.safeParse(decoded)
      if (!parsed.success) {
        const id = recoverId(decoded)
        if (id === null) {
          console.error(`ignoring socket line with no usable request id (${line.length} bytes)`)
          return
        }
        const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`)
        reply({ id, ok: false, error: `invalid request: ${issues.join('; ')}` })
        return
      }

      reply(await handleRequest(parsed.data))
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
    restoreProjects()
    restorePending()

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
    for (const project of projects.values()) teardown(project)
    return new Promise((resolve) => {
      if (!server) return resolve()
      server.close(() => resolve())
    })
  }

  return {
    listen,
    close,
    closeProject,
    projects: listProjects,
    open,
    createContract,
    pending: listPending,
    decide,
    edits: (root: string): EditSummary[] => {
      loadProject(root)
      return listEdits(root)
    },
    edit: (root: string, id: string): Edit => {
      loadProject(root)
      return readEdit(root, id)
    },
    createEdit: (root: string, architecture: Architecture): Edit => {
      loadProject(root)
      return createEdit(root, architecture)
    },
    updateEdit: (root: string, id: string, architecture: Architecture): Edit => {
      loadProject(root)
      return updateEdit(root, id, architecture)
    },
    handEdit: (root: string, id: string): Edit => {
      loadProject(root)
      return handEdit(root, id)
    },
    deleteEdit: (root: string, id: string): void => {
      loadProject(root)
      deleteEdit(root, id)
    },
    codeMap: (root: string): CodeMap | null => readStoredMap(root)?.map ?? null,
    ownership: (root: string): Ownership | null => {
      const map = readStoredMap(root)?.map
      const architecture = loadProject(root).architecture
      if (!map || !architecture) return null
      const files = map.folders.flatMap((folder) => folder.files.map((file) => file.path))
      return ownership(files, architecture.components)
    },
    readSource,
    rescan: rescanProject,
    onChange: (fn: (a: Architecture) => void) => {
      changeListener = fn
    },
    onPending: (fn: (p: Pending[]) => void) => {
      pendingListener = fn
    },
    onProjects: (fn: (p: ProjectSummary[]) => void) => {
      projectsListener = fn
    },
    onCodeMap: (fn: (root: string, map: CodeMap) => void) => {
      codeMapListener = fn
    },
  }
}
