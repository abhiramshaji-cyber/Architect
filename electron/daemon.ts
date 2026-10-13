import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { SOCKET_PATH } from '../shared/socket'
import {
  type Architecture,
  type CodeMap,
  type ContractState,
  type Decision,
  type DraftResult,
  type Edit,
  type EditSummary,
  type HistoryEntry,
  historyEntrySchema,
  type OpenedProject,
  type Ownership,
  type ProjectSummary,
  type Proposal,
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
import { describe, type DescriptionCache } from './scan/describe'
import { type ClaudeRun, draft, runClaude, skeleton } from './draft/draft'
import { createEdit, deleteEdit, handEdit, listEdits, readEdit, updateEdit } from './contract/edits'
import { apply, check, ownership, parse, serialize } from './contract/graph'
import { codeDiff, contractDiff, type Diff, isEmpty } from './contract/history'
import { IGNORED_DIRS, scan } from './scan/scan'
import { locateSession } from './git/session'

const MAP_VERSION = 3

const LEGACY_MAP = path.join('.architect', 'map.json')

function canonicalRoot(root: string): string {
  const resolved = path.resolve(root)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

function cacheKey(root: string): string {
  return createHash('sha256').update(canonicalRoot(root)).digest('hex')
}

function mapPath(dir: string, root: string) {
  return path.join(dir, 'maps', `${cacheKey(root)}.json`)
}

function historyPath(dir: string, root: string) {
  return path.join(dir, 'history', `${cacheKey(root)}.json`)
}

const HISTORY_LIMIT = 200

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

type StoredMap = { map: CodeMap | null; cache: DescriptionCache }

function decodeStoredMap(raw: string, key: string | null): StoredMap | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const { version, root, map, cache } = parsed as {
    version?: unknown
    root?: unknown
    map?: unknown
    cache?: unknown
  }
  if (key !== null && root !== key) return null

  const entries =
    typeof cache === 'object' && cache !== null && !Array.isArray(cache)
      ? Object.entries(cache).filter((e): e is [string, string] => typeof e[1] === 'string')
      : []

  const current = version === MAP_VERSION && isCodeMap(map) ? map : null

  return { map: current, cache: Object.fromEntries(entries) }
}

function discardLegacyMap(root: string) {
  const legacy = path.join(root, LEGACY_MAP)
  const dir = path.join(root, '.architect')
  try {
    if (!fs.existsSync(legacy)) return
    if (spawnSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', LEGACY_MAP], { stdio: 'ignore' }).status === 0) return
    fs.rmSync(legacy, { force: true })
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
  } catch (err) {
    console.error('could not remove the code map from the project:', errorText(err))
  }
}

function migrateLegacyMap(dir: string, root: string): StoredMap | null {
  const legacy = path.join(root, LEGACY_MAP)

  let raw: string
  try {
    raw = fs.readFileSync(legacy, 'utf8')
  } catch {
    return null
  }

  const stored = decodeStoredMap(raw, null)
  if (!stored) return null

  try {
    writeStoredMap(dir, root, stored)
  } catch (err) {
    console.error('could not move the code map out of the project:', errorText(err))
    return stored
  }

  discardLegacyMap(root)

  return stored
}

function readCachedMap(dir: string, root: string): StoredMap | null {
  let raw: string
  try {
    raw = fs.readFileSync(mapPath(dir, root), 'utf8')
  } catch {
    return null
  }

  return decodeStoredMap(raw, cacheKey(root))
}

function readStoredMap(dir: string, root: string): StoredMap | null {
  if (!fs.statSync(path.resolve(root), { throwIfNoEntry: false })?.isDirectory()) return null

  const cached = readCachedMap(dir, root)
  if (!cached) return migrateLegacyMap(dir, root)

  discardLegacyMap(root)

  return cached
}

function writeStoredMap(dir: string, root: string, stored: StoredMap) {
  const file = mapPath(dir, root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ version: MAP_VERSION, root: cacheKey(root), ...stored }, null, 2))
}

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
  watcher: FSWatcher
  sources: Closable
  rescanTimer: ReturnType<typeof setTimeout> | null
  rescanning: boolean
  rescanAgain: boolean
  touched: Set<string>
  lastWrittenContent: string | null
}

type DaemonOptions = {
  socketPath?: string
  rescanDebounceMs?: number
  claude?: ClaudeRun
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
  const claude = options.claude ?? runClaude

  const projects = new Map<string, ProjectState>()
  const histories = new Map<string, HistoryEntry[]>()
  let changeListener: ((root: string, architecture: Architecture) => void) | null = null
  let historyListener: ((entry: HistoryEntry) => void) | null = null
  let projectsListener: ((p: ProjectSummary[]) => void) | null = null
  let codeMapListener: ((root: string, map: CodeMap) => void) | null = null
  let sessionListener: ((root: string, file: string) => void) | null = null
  const sessionCwds = new Map<string, string>()
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

  function historyOf(root: string): HistoryEntry[] {
    const known = histories.get(root)
    if (known) return known

    let stored: unknown
    try {
      stored = JSON.parse(fs.readFileSync(historyPath(cacheDir, root), 'utf8'))
    } catch {
      stored = []
    }
    const entries = Array.isArray(stored) ? stored.flatMap((raw) => historyEntrySchema.safeParse(raw).data ?? []) : []
    histories.set(root, entries)
    return entries
  }

  function record(root: string, source: HistoryEntry['source'], diff: Diff, file?: string) {
    if (isEmpty(diff)) return

    const entry: HistoryEntry = { id: randomUUID(), root, at: Date.now(), source, ...diff, ...(file === undefined ? {} : { file }) }
    const entries = [entry, ...historyOf(root)].slice(0, HISTORY_LIMIT)
    histories.set(root, entries)

    try {
      const target = historyPath(cacheDir, root)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, JSON.stringify(entries))
    } catch (err) {
      console.error('could not persist history:', errorText(err))
    }
    historyListener?.(entry)
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

  async function rescanProject(root: string, touched: string[] = []): Promise<CodeMap> {
    const stored = readStoredMap(cacheDir, root)
    const described = await describe(await scan(root), root, stored?.cache)
    if (stored?.map) record(root, 'code', codeDiff(stored.map, described.map, touched), touched.at(-1))

    try {
      writeStoredMap(cacheDir, root, described)
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
    const touched = [...state.touched]
    state.touched.clear()
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

  async function touchSession(cwd: string, session: string | undefined, file: string | undefined): Promise<string | null> {
    if (!file) {
      if (session) sessionCwds.set(session, cwd)
      return null
    }

    const located = await locateSession((session && sessionCwds.get(session)) || cwd, file)
    if (!located?.file) return null

    const state = loadProject(located.root)
    const relative = path.relative(located.root, located.file).split(path.sep).join('/')
    state.touched.add(relative)
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
      watcher: null as unknown as FSWatcher,
      sources: null as unknown as Closable,
      rescanTimer: null,
      rescanning: false,
      rescanAgain: false,
      touched: new Set(),
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
      record(state.root, 'contract', contractDiff(architecture, state.architecture))
      if (state.contract.status === 'ready' && state.architecture) changeListener?.(state.root, state.architecture)
    })
    state.watcher = watcher

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
    changeListener?.(state.root, architecture)
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

  function proposeChange(root: string, proposal: Proposal): Decision {
    const state = loadProject(root)
    if (proposal.kind === 'contract') return adopt(state, proposal.markdown)
    if (state.contract.status === 'invalid') return { status: 'rejected', reason: state.contract.error }
    if (!state.architecture) return { status: 'rejected', reason: `${root} has no architect.md` }

    if (proposal.kind === 'edge') {
      const verdict = check(state.architecture, proposal.from, proposal.to)
      if (verdict.status === 'forbidden') {
        return { status: 'rejected', reason: `${proposal.from} -> ${proposal.to} is forbidden: ${verdict.reason}` }
      }
    }

    try {
      const content = serialize(apply(state.architecture, proposal))
      if (content !== serialize(state.architecture)) writeContract(state, parse(content), content)
      return { status: 'approved' }
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

  async function draftContract(root: string): Promise<DraftResult<string>> {
    const state = loadProject(root)
    if (state.contract.status !== 'missing') throw new Error(`${root} already has an architect.md`)

    const drafted = await draft(root, readStoredMap(cacheDir, root)?.map ?? (await rescanProject(root)), claude)
    if (!drafted.ok) return drafted

    const adopted = adopt(state, drafted.value)
    if (adopted.status === 'rejected') throw new Error(adopted.reason)
    return drafted
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
          return { id: req.id, ok: true, result: proposeChange(root, req.proposal) }
        }

        if (req.op === 'session-event') {
          return { id: req.id, ok: true, result: await touchSession(req.cwd, req.session, req.file) }
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
    fs.rm(path.join(cacheDir, 'pending.json'), { force: true }, () => {})

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
    draftContract,
    history: (root: string): HistoryEntry[] => historyOf(root),
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
      return ownership(files, architecture.components)
    },
    readSource,
    openSource,
    writeSource,
    readTree,
    rescan: rescanProject,
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
  }
}
