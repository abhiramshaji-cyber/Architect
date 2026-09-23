import { useSyncExternalStore } from 'react'
import type {
  Architecture,
  CodeMap,
  ContractState,
  DraftFailure,
  Edit,
  EditSummary,
  Ownership,
  Pending,
  ProjectSummary,
} from '../../shared/types'
import { isDirty, refusalOf, type Buffer } from './buffer'
import type { OpResult } from './edit-ops'

export type ProjectEntry = {
  status: 'loading' | 'ready' | 'error'
  architecture: Architecture | null
  contract: ContractState | null
  error: string | null
  edits: EditSummary[]
  draft: Edit | null
  dirty: boolean
  busy: boolean
  codeMap: CodeMap | null | undefined
  codeBusy: boolean
  codeError: string | null
  owners: Ownership | null
  drafting: boolean
  draftError: DraftFailure | null
  file: Buffer | null
  fileLine: number | null
  fileBusy: boolean
  fileNotice: { text: string; error: boolean } | null
}

export type ProjectState = {
  projects: ProjectSummary[]
  currentRoot: string | null
  entries: Record<string, ProjectEntry>
  pending: Pending[]
  reassign: Record<string, string>
  message: { text: string; error: boolean } | null
  architecture: Architecture | null
  contract: ContractState | null
  edits: EditSummary[]
  draft: Edit | null
  dirty: boolean
  busy: boolean
  codeMap: CodeMap | null | undefined
  codeBusy: boolean
  codeError: string | null
  owners: Ownership | null
  drafting: boolean
  draftError: DraftFailure | null
  file: Buffer | null
  fileLine: number | null
  fileBusy: boolean
  fileNotice: { text: string; error: boolean } | null
}

function emptyEntry(status: ProjectEntry['status'] = 'loading'): ProjectEntry {
  return {
    status,
    architecture: null,
    contract: null,
    error: null,
    edits: [],
    draft: null,
    dirty: false,
    busy: false,
    codeMap: undefined,
    codeBusy: false,
    codeError: null,
    owners: null,
    drafting: false,
    draftError: null,
    file: null,
    fileLine: null,
    fileBusy: false,
    fileNotice: null,
  }
}

function activeView(entries: Record<string, ProjectEntry>, root: string | null) {
  const entry = root ? entries[root] : undefined
  return {
    architecture: entry?.architecture ?? null,
    contract: entry?.contract ?? null,
    edits: entry?.edits ?? [],
    draft: entry?.draft ?? null,
    dirty: entry?.dirty ?? false,
    busy: entry?.busy ?? false,
    codeMap: entry?.codeMap,
    codeBusy: entry?.codeBusy ?? false,
    codeError: entry?.codeError ?? null,
    owners: entry?.owners ?? null,
    drafting: entry?.drafting ?? false,
    draftError: entry?.draftError ?? null,
    file: entry?.file ?? null,
    fileLine: entry?.fileLine ?? null,
    fileBusy: entry?.fileBusy ?? false,
    fileNotice: entry?.fileNotice ?? null,
  }
}

let state: ProjectState = {
  projects: [],
  currentRoot: null,
  entries: {},
  pending: [],
  reassign: {},
  message: null,
  ...activeView({}, null),
}

const listeners = new Set<() => void>()

function set(patch: Partial<ProjectState>): void {
  let next: ProjectState = { ...state, ...patch }
  if ('entries' in patch || 'currentRoot' in patch) {
    next = { ...next, ...activeView(next.entries, next.currentRoot) }
  }
  state = next
  for (const listen of listeners) listen()
}

function patchEntry(root: string, patch: Partial<ProjectEntry>): void {
  const existing = state.entries[root]
  if (!existing) return
  set({ entries: { ...state.entries, [root]: { ...existing, ...patch } } })
}

function subscribe(listen: () => void): () => void {
  listeners.add(listen)
  return () => {
    listeners.delete(listen)
  }
}

function snapshot(): ProjectState {
  return state
}

export function useProject(): ProjectState {
  return useSyncExternalStore(subscribe, snapshot)
}

export { snapshot as getSnapshot }

export function parseErrorOf(s: ProjectState): string | null {
  return s.contract?.status === 'invalid' ? s.contract.error : null
}

export function loadErrorOf(s: ProjectState): string | null {
  return s.currentRoot ? s.entries[s.currentRoot]?.error ?? null : null
}

export function pendingHere(s: ProjectState): Pending[] {
  return s.pending
    .filter((p) => p.projectRoot === s.currentRoot)
    .map((p) => {
      const reassigned = p.proposal.kind === 'file' ? s.reassign[p.id] : undefined
      if (!reassigned || p.proposal.kind !== 'file') return p
      return { ...p, proposal: { ...p.proposal, component: reassigned } }
    })
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function fail(err: unknown): void {
  set({ message: { text: errorText(err), error: true } })
}

async function run(root: string, fn: () => Promise<void>): Promise<void> {
  patchEntry(root, { busy: true })
  try {
    await fn()
  } catch (err) {
    fail(err)
  } finally {
    patchEntry(root, { busy: false })
  }
}

function discardOk(entry: ProjectEntry | undefined): boolean {
  return !entry?.dirty || confirm('This edit has unsaved changes. Discard them?')
}

let started = false

export function start(): void {
  if (started) return
  started = true

  window.architect.projects().then(loadedProjects)
  window.architect.pending().then(loadedPending)
  window.architect.onChange((a) => {
    const root = state.currentRoot
    if (!root || !state.entries[root]) return
    patchEntry(root, { architecture: a })
    loadOwners(root)
  })
  window.architect.onPending(loadedPending)
  window.architect.onProjects(loadedProjects)
}

function loadedProjects(projects: ProjectSummary[]): void {
  const entries = { ...state.entries }
  for (const p of projects) {
    const entry = entries[p.root]
    if (entry?.status === 'ready') entries[p.root] = { ...entry, contract: p.contract }
  }
  set({ projects, entries })
  if (Object.keys(state.entries).length > 0) return
  for (const p of projects) openProject(p.root)
  const preferred = state.pending[0]?.projectRoot ?? projects[0]?.root
  if (preferred) openProject(preferred)
}

function loadedPending(pending: Pending[]): void {
  set({ pending })
  if (Object.keys(state.entries).length > 0) return
  const root = pending[0]?.projectRoot
  if (root) openProject(root)
}

export function openProject(root: string): void {
  const existing = state.entries[root]
  const loaded = !!existing && existing.status !== 'error'
  set({
    entries: { ...state.entries, [root]: existing ?? emptyEntry() },
    currentRoot: root,
    message: null,
  })

  void window.architect
    .open(root)
    .then(({ architecture, contract }) => {
      if (!state.entries[root]) return
      patchEntry(root, { status: 'ready', architecture, contract, error: null })
      if (!loaded) {
        loadEdits(root)
        loadOwners(root)
      }
    })
    .catch((err: unknown) => {
      if (!state.entries[root]) return
      patchEntry(root, { status: 'error', architecture: null, contract: null, error: errorText(err) })
    })
}

export function createContract(): void {
  const root = state.currentRoot
  if (!root || state.entries[root]?.contract?.status !== 'missing') return

  void run(root, async () => {
    const architecture = await window.architect.createContract(root)
    if (!state.entries[root]) return
    patchEntry(root, { architecture, contract: { status: 'ready' } })
    loadOwners(root)
  })
}

export function draftContract(): void {
  const root = state.currentRoot
  if (!root || state.entries[root]?.contract?.status !== 'missing') return
  if (state.entries[root]?.drafting) return

  patchEntry(root, { drafting: true, draftError: null })
  void window.architect
    .draftContract(root)
    .then((result) => {
      if (!state.entries[root]) return
      patchEntry(root, { drafting: false, draftError: result.ok ? null : result.error })
    })
    .catch((err: unknown) => {
      if (!state.entries[root]) return
      patchEntry(root, { drafting: false, draftError: { kind: 'failed', code: 1, stderr: errorText(err) } })
    })
}

export function closeProject(root: string): void {
  const entry = state.entries[root]
  if (entry && !discardOk(entry)) return

  const entries = { ...state.entries }
  delete entries[root]
  const currentRoot = state.currentRoot === root ? Object.keys(entries)[0] ?? null : state.currentRoot
  set({ entries, currentRoot })

  void window.architect.closeProject(root).catch(fail)
}

function loadEdits(root: string): void {
  window.architect
    .edits(root)
    .then((edits) => patchEntry(root, { edits }))
    .catch((err: unknown) => {
      if (state.entries[root]) fail(err)
    })
}

function loadOwners(root: string): void {
  window.architect
    .ownership(root)
    .then((owners) => patchEntry(root, { owners }))
    .catch(() => patchEntry(root, { owners: null }))
}

export function loadCodeMap(): void {
  const root = state.currentRoot
  const entry = root ? state.entries[root] : undefined
  if (!root || !entry || entry.codeMap !== undefined || entry.codeBusy) return
  patchEntry(root, { codeBusy: true })
  window.architect
    .getCodeMap(root)
    .then((codeMap) => {
      if (!state.entries[root]) return
      patchEntry(root, { codeMap, codeBusy: false })
      loadOwners(root)
    })
    .catch((err: unknown) => {
      if (!state.entries[root]) return
      patchEntry(root, { codeError: errorText(err), codeBusy: false })
    })
}

export function rescan(): void {
  const root = state.currentRoot
  const entry = root ? state.entries[root] : undefined
  if (!root || !entry || entry.codeBusy) return
  patchEntry(root, { codeBusy: true, codeError: null })
  window.architect
    .rescan(root)
    .then((codeMap) => {
      if (!state.entries[root]) return
      patchEntry(root, { codeMap, codeBusy: false })
      loadOwners(root)
    })
    .catch((err: unknown) => {
      if (!state.entries[root]) return
      patchEntry(root, { codeError: errorText(err), codeBusy: false })
    })
}

export function reassignFile(id: string, component: string): void {
  set({ reassign: { ...state.reassign, [id]: component } })
}

export function decide(id: string, approved: boolean, reason?: string, component?: string): void {
  void window.architect.decide(id, approved, reason, component)
}

export function newEdit(): void {
  const root = state.currentRoot
  const entry = root ? state.entries[root] : undefined
  const architecture = entry?.architecture
  if (!root || !entry || !architecture || entry.busy || !discardOk(entry)) return
  void run(root, async () => {
    const draft = await window.architect.createEdit(root, architecture)
    if (state.entries[root]) patchEntry(root, { draft, dirty: false })
    set({ message: null })
    const edits = await window.architect.edits(root)
    if (state.entries[root]) patchEntry(root, { edits })
  })
}

export function openEdit(id: string): void {
  const root = state.currentRoot
  const entry = root ? state.entries[root] : undefined
  if (!root || !entry || entry.busy || !discardOk(entry)) return
  void run(root, async () => {
    const draft = await window.architect.edit(root, id)
    if (state.entries[root]) patchEntry(root, { draft, dirty: false })
    set({ message: null })
  })
}

export function applyEdit(op: (a: Architecture) => OpResult): Architecture | null {
  const root = state.currentRoot
  const entry = root ? state.entries[root] : undefined
  const draft = entry?.draft
  if (!root || !draft || draft.status === 'handed') return null
  const result = op(draft.architecture)
  if (!result.ok) {
    set({ message: { text: result.error, error: true } })
    return null
  }

  patchEntry(root, { draft: { ...draft, architecture: result.architecture }, dirty: true })
  set({ message: null })
  return result.architecture
}

export function saveEdit(): void {
  const root = state.currentRoot
  const entry = root ? state.entries[root] : undefined
  const draft = entry?.draft
  if (!root || !entry || !draft || draft.status === 'handed' || entry.busy) return
  void run(root, async () => {
    const saved = await window.architect.updateEdit(root, draft.id, draft.architecture)
    if (state.entries[root]) patchEntry(root, { draft: saved, dirty: false })
    set({ message: { text: 'Saved', error: false } })
    const edits = await window.architect.edits(root)
    if (state.entries[root]) patchEntry(root, { edits })
  })
}

export function handEdit(): void {
  const root = state.currentRoot
  const entry = root ? state.entries[root] : undefined
  const draft = entry?.draft
  if (!root || !entry || !draft || draft.status === 'handed' || entry.busy) return
  const warning = entry.dirty ? ' Unsaved changes will not be included.' : ''
  if (!confirm(`Hand edit ${draft.id} to Claude? It becomes permanently read only.${warning}`)) return
  void run(root, async () => {
    const handed = await window.architect.handEdit(root, draft.id)
    if (state.entries[root]) {
      patchEntry(root, { draft: handed, dirty: false })
    }
    set({ message: { text: 'Handed to Claude. This edit is now read only.', error: false } })
    const edits = await window.architect.edits(root)
    if (state.entries[root]) patchEntry(root, { edits })
  })
}

export function removeEdit(): void {
  const root = state.currentRoot
  const entry = root ? state.entries[root] : undefined
  const draft = entry?.draft
  if (!root || !entry || !draft) return
  if (!confirm(`Delete the whole edit ${draft.id} and every change in it? This cannot be undone.`)) return
  void run(root, async () => {
    await window.architect.deleteEdit(root, draft.id)
    if (state.entries[root]) patchEntry(root, { draft: null, dirty: false })
    set({ message: null })
    const edits = await window.architect.edits(root)
    if (state.entries[root]) patchEntry(root, { edits })
  })
}

export function closeEdit(): void {
  const root = state.currentRoot
  const entry = root ? state.entries[root] : undefined
  if (!root || !entry || entry.busy || !discardOk(entry)) return
  patchEntry(root, { draft: null, dirty: false })
  set({ message: null })
}

let fileRequest = 0

export function openFile(path: string, line?: number): void {
  const root = state.currentRoot
  const entry = root ? state.entries[root] : undefined
  if (!root || !entry) return

  if (entry.file?.path === path) {
    patchEntry(root, { fileLine: line ?? null })
    return
  }

  if (isDirty(entry.file) && !confirm(`${entry.file?.path} has unsaved changes. Discard them?`)) return

  const token = ++fileRequest
  patchEntry(root, { file: null, fileLine: line ?? null, fileBusy: true, fileNotice: null })
  void window.architect
    .openSource(root, path)
    .then((source) => {
      if (token !== fileRequest || !state.entries[root]) return
      patchEntry(root, {
        file: { path, disk: source.text, hash: source.hash, draft: source.text, error: source.error },
        fileBusy: false,
      })
    })
    .catch((err: unknown) => {
      if (token !== fileRequest || !state.entries[root]) return
      patchEntry(root, {
        file: { path, disk: '', hash: '', draft: '', error: 'unreadable' },
        fileBusy: false,
        fileNotice: { text: errorText(err), error: true },
      })
    })
}

export function reloadFile(): void {
  const root = state.currentRoot
  const entry = root ? state.entries[root] : undefined
  const open = entry?.file
  if (!root || !entry || !open) return
  patchEntry(root, { file: null })
  openFile(open.path, entry.fileLine ?? undefined)
}

export function editFile(draft: string): void {
  const root = state.currentRoot
  const entry = root ? state.entries[root] : undefined
  const open = entry?.file
  if (!root || !open || open.error !== null || open.draft === draft) return
  patchEntry(root, { file: { ...open, draft }, fileNotice: null })
}

export function revertFile(): void {
  const root = state.currentRoot
  const entry = root ? state.entries[root] : undefined
  const open = entry?.file
  if (!root || !open || !isDirty(open)) return
  patchEntry(root, { file: { ...open, draft: open.disk }, fileNotice: null })
}

export function saveFile(): void {
  const root = state.currentRoot
  const entry = root ? state.entries[root] : undefined
  const open = entry?.file
  if (!root || !entry || !open || entry.fileBusy || !isDirty(open)) return

  const draft = open.draft
  patchEntry(root, { fileBusy: true, fileNotice: null })
  void window.architect
    .writeSource(root, open.path, draft, open.hash)
    .then((result) => {
      const still = state.entries[root]?.file
      if (!still || still.path !== open.path) return
      if (result.error !== null) {
        patchEntry(root, { fileBusy: false, fileNotice: { text: refusalOf(result.error), error: true } })
        return
      }
      patchEntry(root, {
        file: { ...still, disk: draft, hash: result.hash },
        fileBusy: false,
        fileNotice: { text: 'Saved', error: false },
      })
    })
    .catch((err: unknown) => {
      if (!state.entries[root]) return
      patchEntry(root, { fileBusy: false, fileNotice: { text: errorText(err), error: true } })
    })
}

export function closeFile(): void {
  const root = state.currentRoot
  const entry = root ? state.entries[root] : undefined
  if (!root || !entry) return
  if (isDirty(entry.file) && !confirm(`${entry.file?.path} has unsaved changes. Discard them?`)) return
  patchEntry(root, { file: null, fileLine: null, fileNotice: null, fileBusy: false })
}
