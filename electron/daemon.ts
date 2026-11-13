import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import chokidar from 'chokidar'
import { folderShaped } from '../shared/folders'
import { SOCKET_PATH } from '../shared/socket'
import {
  type Architecture,
  type CodeMap,
  type ContractState,
  type Decision,
  type DraftFailure,
  type DraftResult,
  type Edit,
  type EditSummary,
  type FunctionList,
  type Recency,
  type HistoryEntry,
  HISTORY_LIMIT,
  historyEntrySchema,
  type VerdictRecord,
  verdictRecordSchema,
  type OpenedProject,
  type Ownership,
  type ProjectSummary,
  type Proposal,
  type ReviewState,
  requestSchema,
  type Request,
  type Response,
  type SourceFile,
  type SourceWindow,
  type TreeEntry,
  type TreeListing,
  type WriteError,
  type WriteResult,
  type Verdict,
} from '../shared/types'
import { describe } from './scan/describe'
import { cacheKey, readStoredMap, writeStoredMap } from './scan/cache'
import { aiRun, type AiRun } from './ai'
import { draft, skeleton } from './draft/draft'
import { scopeOf } from './draft/scope'
import { createEdit, deleteEdit, handEdit, listEdits, readEdit, updateEdit } from './contract/edits'
import { apply, check, ownership, parse, serialize } from './contract/graph'
import { contractDiff, type Touch } from './contract/history'
import { createClaims } from './contract/claims'
import { IGNORED_DIRS, scan } from './scan/scan'
import { locateSession } from './git/session'
import { listFunctions } from './functions'
import { flowIn } from './flow'
import { layersOf } from './layers'
import { blameFiles } from './git/blame'
import { recencyOf } from './recency'
import { churnOf } from './churn'
import { createReview } from './review'
import { createJournal } from './journal'
import { styleIn } from './rules/style'
import { hasAgents, writeAgents } from './agents/write'
import { answerWhere } from './where'
import { evidenceOf } from './evidence'
import { impactFor, impactSchema, scanOf, type Impact } from './impact'
import { cutFor, cutSchema, type Cut } from './cut'
import { changeVerdict } from './verdict'
import { watchContract } from './watch/contract'


const MAX_SOURCE_LINES = 400

const MAX_SOURCE_BYTES = 4 * 1024 * 1024

function digest(raw: Buffer | string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function decode(raw: Buffer): string | null {
  let text: string
  try {
    text = new TextDecoder('utf8', { fatal: true }).decode(raw)
  } catch {
    return null
  }
  return text.includes('\u0000') ? null : text
}

function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

const RESCAN_DEBOUNCE_MS = 300

type Kinded = { isFile(): boolean; isDirectory(): boolean }

type Closable = { close(): unknown }

const NATIVE_RECURSIVE = process.platform === 'darwin' || process.platform === 'win32'

function isIgnoredSource(root: string, target: string, stats?: Kinded): boolean {
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

function kindOf(target: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(target)
  } catch {
    return undefined
  }
}

function watchSources(root: string, changed: () => void): Closable {
  const failed = (err: unknown) => console.error(`source watcher for ${root}:`, errorText(err))

  if (!NATIVE_RECURSIVE) {
    const sources = chokidar.watch(root, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (target: string, stats?: fs.Stats) => isIgnoredSource(root, target, stats),
    })
    sources.on('all', changed)
    sources.on('error', failed)
    return sources
  }

  const sources = fs.watch(root, { recursive: true }, (_event, file) => {
    const target = file ? path.join(root, file) : root
    if (!isIgnoredSource(root, target, kindOf(target))) changed()
  })
  sources.on('error', failed)
  return sources
}

type ProjectState = {
  root: string
  architecture: Architecture | null
  contract: ContractState
  watcher: Closable
  sources: Closable
  rescanTimer: ReturnType<typeof setTimeout> | null
  rescanning: boolean
  rescanAgain: boolean
  touched: Touch[]
  lastWrittenContent: string | null
}

type DaemonOptions = {
  socketPath?: string
  rescanDebounceMs?: number
  claude?: AiRun
  reviewTimeouts?: { proposal?: number; edit?: number }
}

function sameContract(a: ContractState, b: ContractState): boolean {
  if (a.status === 'invalid' && b.status === 'invalid') return a.error === b.error
  return a.status === b.status
}

function starterArchitecture(root: string, map: CodeMap): Architecture {
  return {
    title: path.basename(root),
    summary: 'A starter contract from the folders Architect scanned. Say what each component is for and draw the dependencies.',
    components: skeleton(map),
    edges: [],
    forbidden: [],
    packages: [],
  }
}

const shapes = new WeakMap<Architecture, boolean>()

function foldersOnly(root: string, architecture: Architecture): boolean {
  const known = shapes.get(architecture)
  if (known !== undefined) return known

  let tops: string[] = []
  try {
    const entries = fs.readdirSync(path.join(root, architecture.scope ?? ''), { withFileTypes: true })
    tops = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {}

  const shaped = folderShaped(architecture, tops)
  shapes.set(architecture, shaped)
  return shaped
}

function redrawable(state: ProjectState): boolean {
  return state.contract.status === 'ready' && state.architecture !== null && foldersOnly(state.root, state.architecture)
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
  const cacheDir = path.dirname(socketPath)
  const rescanDebounceMs = options.rescanDebounceMs ?? RESCAN_DEBOUNCE_MS
  const claude = options.claude ?? aiRun(cacheDir)

  const projects = new Map<string, ProjectState>()
  const histories = createJournal((root) => path.join(cacheDir, 'history', `${cacheKey(root)}.json`), historyEntrySchema, HISTORY_LIMIT)
  const verdicts = createJournal((root) => path.join(cacheDir, 'verdicts', `${cacheKey(root)}.json`), verdictRecordSchema.extend({ impact: impactSchema.optional().catch(undefined), cut: cutSchema.optional().catch(undefined) }), HISTORY_LIMIT)
  let changeListener: ((root: string, architecture: Architecture) => void) | null = null
  let historyListener: ((entry: HistoryEntry) => void) | null = null
  let projectsListener: ((p: ProjectSummary[]) => void) | null = null
  let codeMapListener: ((root: string, map: CodeMap) => void) | null = null
  let sessionListener: ((root: string, file: string) => void) | null = null
  let reviewListener: ((state: ReviewState) => void) | null = null
  const review = createReview(cacheDir, (state) => reviewListener?.(state), options.reviewTimeouts)
  const sessionCwds = new Map<string, string>()
  const { record, changes } = createClaims(histories, HISTORY_LIMIT, (entry) => historyListener?.(entry))
  const drafting = new Map<string, Promise<DraftResult<string>>>()
  const draftFailures = new Map<string, DraftFailure>()
  let server: net.Server | null = null

  async function locate(root: string, file: string): Promise<{ base: string; target: string } | 'unreadable' | 'outside'> {
    let base: string
    let target: string
    try {
      base = await fs.promises.realpath(root)
      target = await fs.promises.realpath(path.resolve(base, file))
    } catch {
      return 'unreadable'
    }

    if (target !== base && !target.startsWith(base + path.sep)) return 'outside'
    return { base, target }
  }

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

    const found = await locate(root, file)
    if (typeof found === 'string') return { ...empty, error: found }

    let raw: Buffer
    try {
      raw = await fs.promises.readFile(found.target)
    } catch {
      return { ...empty, error: 'unreadable' }
    }

    const text = decode(raw)
    if (text === null) return { ...empty, error: 'binary' }

    const lines = splitLines(text)

    return { from: start, lines: lines.slice(start - 1, start - 1 + span), total: lines.length, error: null }
  }

  async function openSource(root: string, file: string): Promise<SourceFile> {
    const empty = { text: '', hash: '' }

    if (!projects.has(root)) return { ...empty, error: 'closed' }

    const found = await locate(root, file)
    if (typeof found === 'string') return { ...empty, error: found }

    let raw: Buffer
    try {
      const stats = await fs.promises.stat(found.target)
      if (!stats.isFile()) return { ...empty, error: 'unreadable' }
      if (stats.size > MAX_SOURCE_BYTES) return { ...empty, error: 'large' }
      raw = await fs.promises.readFile(found.target)
    } catch {
      return { ...empty, error: 'unreadable' }
    }

    const text = decode(raw)
    if (text === null) return { ...empty, error: 'binary' }

    return { text, hash: digest(raw), error: null }
  }

  async function writeSource(
    root: string,
    file: string,
    text: string,
    baseline: string
  ): Promise<WriteResult> {
    const refused = (error: WriteError): WriteResult => ({ hash: '', error })

    if (!projects.has(root)) return refused('closed')
    if (Buffer.byteLength(text) > MAX_SOURCE_BYTES) return refused('large')

    const found = await locate(root, file)
    if (typeof found === 'string') return refused(found)

    let current: Buffer
    let mode: number
    try {
      const stats = await fs.promises.stat(found.target)
      if (!stats.isFile()) return refused('unreadable')
      mode = stats.mode & 0o777
      current = await fs.promises.readFile(found.target)
    } catch {
      return refused('unreadable')
    }

    if (decode(current) === null) return refused('binary')
    if (digest(current) !== baseline) return refused('stale')

    // a rename replaces a read only file, so the write bit has to be checked before we swap
    try {
      await fs.promises.access(found.target, fs.constants.W_OK)
    } catch {
      return refused('denied')
    }

    const next = Buffer.from(text, 'utf8')
    const temp = path.join(path.dirname(found.target), `.${path.basename(found.target)}.architect-${randomUUID()}`)

    try {
      const handle = await fs.promises.open(temp, 'wx', mode)
      try {
        await handle.writeFile(next)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.promises.chmod(temp, mode)
      await fs.promises.rename(temp, found.target)
    } catch (err) {
      await fs.promises.rm(temp, { force: true }).catch(() => {})
      const code = (err as NodeJS.ErrnoException).code
      return refused(code === 'EACCES' || code === 'EPERM' || code === 'EROFS' ? 'denied' : 'unreadable')
    }

    return { hash: digest(next), error: null }
  }

  async function readTree(root: string, dir: string): Promise<TreeListing> {
    const empty = { dir, entries: [] }

    if (!projects.has(root)) return { ...empty, error: 'closed' }

    const found = await locate(root, dir)
    if (typeof found === 'string') return { ...empty, error: found }

    let listed: fs.Dirent[]
    try {
      listed = await fs.promises.readdir(found.target, { withFileTypes: true })
    } catch {
      return { ...empty, error: 'unreadable' }
    }

    const kept = listed.filter(
      (entry) => !isIgnoredSource(found.base, path.join(found.target, entry.name), entry)
    )

    const relative = path.relative(found.base, found.target).split(path.sep).filter((part) => part !== '')
    const files = kept.filter((entry) => !entry.isDirectory()).map((entry) => [...relative, entry.name].join('/'))
    const components = projects.get(root)?.architecture?.components ?? []
    const owners = new Map<string, string[]>()
    const classified = ownership(files, components)
    for (const { path: at, owner } of classified.owned) owners.set(at, [owner])
    for (const { path: at, owners: many } of classified.multi) owners.set(at, many)

    const entries: TreeEntry[] = kept
      .map((entry) => ({
        name: entry.name,
        dir: entry.isDirectory(),
        owners: owners.get([...relative, entry.name].join('/')) ?? [],
      }))
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))

    return { dir, entries, error: null }
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

  function listProjects(): ProjectSummary[] {
    return [...projects.values()].map((p) => {
      const failure = draftFailures.get(p.root)
      return {
        root: p.root,
        title: p.architecture?.title ?? path.basename(p.root),
        contract: p.contract,
        ...(redrawable(p) ? { folderShaped: true as const } : {}),
        ...(drafting.has(p.root) ? { drafting: true as const } : {}),
        ...(failure ? { draftError: failure } : {}),
      }
    })
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

  async function rescanProject(root: string, touched: Touch[] = []): Promise<CodeMap> {
    const seen = Date.now()
    const stored = readStoredMap(cacheDir, root)
    const digests = new Map<string, string>()
    const described = describe(await scan(root, digests), root, stored?.cache, claude, () => refill(root))
    for (const change of stored?.map ? changes(root, stored.map, described.map, touched) : []) record(root, 'code', change, seen, digests)

    try {
      writeStoredMap(cacheDir, root, described)
    } catch (err) {
      console.error('could not persist code map:', errorText(err))
    }

    return described.map
  }

  function refill(root: string) {
    const state = projects.get(root)
    if (state) scheduleRescan(state)
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
    const touched = state.touched
    state.touched = []
    try {
      const map = await rescanProject(state.root, touched)
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

  async function touchSession(cwd: string, session?: string, file?: string, digest?: string): Promise<string | null> {
    const at = Date.now()
    if (!file) {
      if (session) sessionCwds.set(session, cwd)
      return null
    }

    const located = await locateSession((session && sessionCwds.get(session)) || cwd, file)
    if (!located?.file) return null

    const state = loadProject(located.root)
    const relative = path.relative(located.root, located.file).split(path.sep).join('/')
    state.touched.push(session ? { file: relative, session, at, ...(digest ? { digest } : {}) } : { file: relative })
    if (state.rescanTimer) clearTimeout(state.rescanTimer)
    state.rescanTimer = null
    void runRescan(state)

    sessionListener?.(located.root, relative)
    return located.root
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
      watcher: null as unknown as Closable,
      sources: null as unknown as Closable,
      rescanTimer: null,
      rescanning: false,
      rescanAgain: false,
      touched: [],
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

    // watch before the first read, or a save landing in between is never seen
    state.watcher = watchContract(filePath, () => {
      const contract = state.contract
      const architecture = state.architecture
      reread()
      if (sameContract(contract, state.contract) && architecture === state.architecture) return

      notifyProjects()
      record(state.root, 'contract', contractDiff(architecture, state.architecture))
      if (state.contract.status === 'ready' && state.architecture) contractChanged(state.root, state.architecture, architecture)
    })
    reread()

    state.sources = watchSources(root, () => scheduleRescan(state))

    projects.set(root, state)
    remembered.add(root)
    saveProjects()
    notifyProjects()
    return state
  }

  function writeContract(state: ProjectState, architecture: Architecture, content: string, exclusive = false) {
    fs.writeFileSync(architectMdPath(state.root), content, exclusive ? { flag: 'wx' } : undefined)
    const before = state.architecture
    state.lastWrittenContent = content
    state.architecture = architecture
    state.contract = { status: 'ready' }
    notifyProjects()
    record(state.root, 'contract', contractDiff(before, architecture))
    contractChanged(state.root, architecture, before)
  }

  function contractChanged(root: string, architecture: Architecture, before: Architecture | null) {
    changeListener?.(root, architecture)
    try {
      if (hasAgents(root, before ? [before, architecture] : [architecture])) writeAgents(root, architecture)
    } catch (err) {
      console.error('could not refresh AGENTS.md:', errorText(err))
    }
  }

  function adopt(state: ProjectState, markdown: string): Decision {
    const taken: Decision = { status: 'rejected', reason: `${state.root} already has an architect.md` }
    if (state.contract.status !== 'missing') return taken

    try {
      writeContract(state, parse(markdown), markdown, true)
      return { status: 'approved' }
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EEXIST' ? taken : { status: 'rejected', reason: errorText(err) }
    }
  }

  function planChange(state: ProjectState, proposal: Exclude<Proposal, { kind: 'contract' }>): Decision | string {
    if (state.contract.status === 'invalid') return { status: 'rejected', reason: state.contract.error }
    if (!state.architecture) return { status: 'rejected', reason: `${state.root} has no architect.md` }

    if (proposal.kind === 'edge') {
      const verdict = check(state.architecture, proposal.from, proposal.to)
      if (verdict.status === 'forbidden') {
        return { status: 'rejected', reason: `${proposal.from} -> ${proposal.to} is forbidden: ${verdict.reason}` }
      }
    }

    try {
      const content = serialize(apply(state.architecture, proposal))
      return content === serialize(state.architecture) ? { status: 'approved' } : content
    } catch (err) {
      return { status: 'rejected', reason: errorText(err) }
    }
  }

  function proposeChange(root: string, proposal: Proposal): Decision {
    const state = loadProject(root)
    if (proposal.kind === 'contract') return adopt(state, proposal.markdown)

    const plan = planChange(state, proposal)
    if (typeof plan !== 'string') return plan
    try {
      writeContract(state, parse(plan), plan)
      return { status: 'approved' }
    } catch (err) {
      return { status: 'rejected', reason: errorText(err) }
    }
  }

  function reviewChange(root: string, proposal: Proposal, rationale: string, signal: AbortSignal): Decision | Promise<Decision> {
    const state = loadProject(root)
    const taken = proposal.kind === 'contract' && state.contract.status !== 'missing'
    if (taken) return { status: 'rejected', reason: `${root} already has an architect.md` }

    const plan = proposal.kind === 'contract' ? adoptable(proposal.markdown) : planChange(state, proposal)
    return typeof plan === 'string' ? review.propose(root, proposal, rationale, signal) : plan
  }

  function adoptable(markdown: string): Decision | string {
    try {
      parse(markdown)
      return markdown
    } catch (err) {
      return { status: 'rejected', reason: errorText(err) }
    }
  }

  async function open(root: string): Promise<OpenedProject> {
    const state = loadProject(root)
    return { contract: state.contract, architecture: state.architecture }
  }

  async function createContract(root: string): Promise<Architecture> {
    const state = loadProject(root)
    if (state.contract.status !== 'missing') throw new Error(`${root} already has an architect.md`)

    const architecture = starterArchitecture(root, readStoredMap(cacheDir, root)?.map ?? (await scan(root)))
    writeContract(state, architecture, serialize(architecture))
    return architecture
  }

  async function mapOf(root: string): Promise<CodeMap> {
    return readStoredMap(cacheDir, root)?.map ?? (await rescanProject(root))
  }

  async function draftContract(root: string): Promise<DraftResult<string>> {
    const running = drafting.get(root)
    if (running) return running

    const job = runDraft(root)
    drafting.set(root, job)
    draftFailures.delete(root)
    notifyProjects()
    try {
      const result = await job
      if (!result.ok) draftFailures.set(root, result.error)
      return result
    } catch (err) {
      draftFailures.set(root, { kind: 'failed', code: 1, stderr: errorText(err) })
      throw err
    } finally {
      drafting.delete(root)
      notifyProjects()
    }
  }

  async function runDraft(root: string): Promise<DraftResult<string>> {
    const state = loadProject(root)
    const redraw = redrawable(state)
    if (state.contract.status !== 'missing' && !redraw) throw new Error(`${root} already has an architect.md`)

    const drafted = await draft(root, await mapOf(root), claude, await scopeOf(root))
    if (!drafted.ok) return drafted

    if (redraw && redrawable(state)) {
      writeContract(state, parse(drafted.value), drafted.value)
      return drafted
    }

    const adopted = adopt(state, drafted.value)
    if (adopted.status === 'rejected') throw new Error(adopted.reason)
    return drafted
  }

  function logVerdict(root: string, req: Extract<Request, { op: 'check_change' }>, verdict: Verdict, stale: string | null, extra: { impact?: Impact; cut?: Cut } = {}, at = Date.now()) {
    verdicts.append(root, {
      id: randomUUID(),
      root,
      at,
      ...(req.from === undefined ? {} : { from: req.from }),
      ...(req.to === undefined ? {} : { to: req.to }),
      ...(req.file === undefined ? {} : { file: req.file }),
      verdict,
      ...extra,
      ...(stale === null ? {} : { stale: true as const }),
      ...(req.session ? { session: req.session } : {}),
    })
  }

  function handleConnection(socket: net.Socket) {
    let buf = ''
    const closed = new AbortController()
    socket.on('close', () => closed.abort())

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
          if (!state.architecture) {
            const error = stale ?? `${root} has no architect.md`
            logVerdict(root, req, { status: 'unknown', reason: error }, stale)
            return { id: req.id, ok: false, error }
          }
          let verdict: Verdict
          try {
            verdict = changeVerdict(cacheDir, root, state.architecture, stale, req)
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err)
            logVerdict(root, req, { status: 'unknown', reason: error }, stale)
            return { id: req.id, ok: false, error }
          }
          const at = Date.now()
          const [impact, cut] = await Promise.all([
            impactFor(req, root, state.architecture, stale, readStoredMap(cacheDir, root)?.map ?? null),
            verdict.status === 'cycle' && req.from && req.to ? cutFor(state.architecture, () => scanOf(root, readStoredMap(cacheDir, root)?.map ?? null), root, req.from, req.to) : undefined,
          ])
          logVerdict(root, req, verdict, stale, { impact, ...(cut ? { cut } : {}) }, at)
          return { id: req.id, ok: true, result: { ...verdict, impact, ...(cut ? { cut } : {}) } }
        }

        if (req.op === 'propose_change') {
          const root = resolveRoot(req.cwd)
          if (!root) return { id: req.id, ok: false, error: `no architecture defined for ${req.cwd}` }
          const decided = review.enabled()
            ? await reviewChange(root, req.proposal, req.rationale, closed.signal)
            : proposeChange(root, req.proposal)
          const { architecture, contract } = loadProject(root)
          const cut = decided.status === 'rejected' && req.proposal.kind === 'edge' && architecture && contract.status === 'ready' && check(architecture, req.proposal.from, req.proposal.to).status === 'cycle' ? await cutFor(architecture, () => scanOf(root, readStoredMap(cacheDir, root)?.map ?? null), root, req.proposal.from, req.proposal.to) : undefined
          return { id: req.id, ok: true, result: cut ? { ...decided, cut } : decided }
        }

        if (req.op === 'await_proposal') return { id: req.id, ok: true, result: await review.resume(req.proposalId, closed.signal) }

        if (req.op === 'review_edit') {
          return { id: req.id, ok: true, result: await review.gate([...projects.keys()], req.change, closed.signal) }
        }

        if (req.op === 'session-event') {
          return { id: req.id, ok: true, result: await touchSession(req.cwd, req.session, req.file, req.digest) }
        }

        if (req.op === 'where') return { id: req.id, ok: true, result: await answerWhere(req, [resolveRoot(req.cwd), ...projects.keys()], loadProject, mapOf) }
        if (req.op === 'evidence') {
          const root = resolveRoot(req.cwd)
          if (!root) return { id: req.id, ok: false, error: `no architecture defined for ${req.cwd}` }
          return { id: req.id, ok: true, result: await evidenceOf(req, root, await mapOf(root)) }
        }
        const root = resolveRoot(req.cwd)
        if (!root) return { id: req.id, ok: false, error: `no architecture defined for ${req.cwd}` }
        loadProject(root)

        if (req.op === 'list_edits') return { id: req.id, ok: true, result: listEdits(root) }
        if (req.op === 'write_agents') {
          const state = loadProject(root)
          if (state.contract.status !== 'ready' || !state.architecture) throw new Error(state.contract.status === 'invalid' ? state.contract.error : `${root} has no architect.md`)
          return { id: req.id, ok: true, result: writeAgents(root, state.architecture) }
        }
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
    draftContract: (root: string) => draftContract(root),
    history: (root: string): HistoryEntry[] => histories.list(root),
    verdicts: (root: string): VerdictRecord[] => verdicts.list(root),
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
    codeMap: (root: string): CodeMap | null => readStoredMap(cacheDir, root)?.map ?? null,
    ownership: (root: string): Ownership | null => {
      const map = readStoredMap(cacheDir, root)?.map
      const architecture = loadProject(root).architecture
      if (!map || !architecture) return null
      const files = map.folders.flatMap((folder) => folder.files.map((file) => file.path))
      const scoped = architecture.scope ? files.filter((file) => file.startsWith(`${architecture.scope}/`)) : files
      return ownership(scoped, architecture.components)
    },
    layers: async (root: string) => layersOf(loadProject(root).architecture, await mapOf(root)),
    flow: async (root: string, ask: unknown) => flowIn(root, loadProject(root).architecture, await mapOf(root), ask),
    readSource,
    openSource,
    writeSource,
    readTree,
    rescan: rescanProject,
    listFunctions: async (root: string, scope?: unknown): Promise<FunctionList> => {
      const { architecture } = loadProject(root)
      return listFunctions(root, await mapOf(root), scope, architecture)
    },
    recency: async (root: string): Promise<Recency> => {
      loadProject(root)
      const map = await mapOf(root)
      const blamed = await blameFiles(root, map.folders.flatMap((folder) => folder.files.map((file) => file.path)))
      return recencyOf(map, loadProject(root).architecture, blamed)
    },
    churn: async (root: string, days?: unknown) => churnOf(root, await mapOf(loadProject(root).root), days),
    style: async (root: string) => styleIn(root, await mapOf(loadProject(root).root), loadProject(root).architecture),
    onChange: (fn: (root: string, architecture: Architecture) => void) => {
      changeListener = fn
    },
    onHistory: (fn: (entry: HistoryEntry) => void) => {
      historyListener = fn
    },
    onProjects: (fn: (p: ProjectSummary[]) => void) => {
      projectsListener = fn
    },
    onCodeMap: (fn: (root: string, map: CodeMap) => void) => {
      codeMapListener = fn
    },
    onSession: (fn: (root: string, file: string) => void) => {
      sessionListener = fn
    },
    review: review.state,
    setReview: review.setEnabled,
    decide: (id: string, approved: boolean, feedback?: string) => review.decide(id, approved, feedback, proposeChange),
    reviewDetail: (id: string) =>
      review.detail(id, (root) => loadProject(root).architecture, async (root) => listFunctions(root, await mapOf(root)).rows),
    onReview: (fn: (state: ReviewState) => void) => {
      reviewListener = fn
    },
  }
}
