import { useSyncExternalStore } from 'react'
import type {
  Architecture,
  CodeMap,
  Edit,
  EditSummary,
  Ownership,
  Pending,
  ProjectSummary,
} from '../../shared/types'
import type { OpResult } from './edit-ops'

export type ProjectEntry = {
  status: 'loading' | 'ready' | 'error'
  architecture: Architecture | null
  error: string | null
  edits: EditSummary[]
  draft: Edit | null
  dirty: boolean
  busy: boolean
  codeMap: CodeMap | null | undefined
  codeBusy: boolean
  codeError: string | null
  owners: Ownership | null
}

export type ProjectState = {
  projects: ProjectSummary[]
  currentRoot: string | null
  entries: Record<string, ProjectEntry>
  pending: Pending[]
  reassign: Record<string, string>
  message: { text: string; error: boolean } | null
  architecture: Architecture | null
  edits: EditSummary[]
  draft: Edit | null
  dirty: boolean
  busy: boolean
  codeMap: CodeMap | null | undefined
  codeBusy: boolean
  codeError: string | null
  owners: Ownership | null
}

function emptyEntry(status: ProjectEntry['status'] = 'loading'): ProjectEntry {
  return {
    status,
    architecture: null,
    error: null,
    edits: [],
    draft: null,
    dirty: false,
    busy: false,
    codeMap: undefined,
    codeBusy: false,
    codeError: null,
    owners: null,
  }
}

function activeView(entries: Record<string, ProjectEntry>, root: string | null) {
  const entry = root ? entries[root] : undefined
  return {
    architecture: entry?.architecture ?? null,
    edits: entry?.edits ?? [],
    draft: entry?.draft ?? null,
    dirty: entry?.dirty ?? false,
    busy: entry?.busy ?? false,
    codeMap: entry?.codeMap,
    codeBusy: entry?.codeBusy ?? false,
    codeError: entry?.codeError ?? null,
    owners: entry?.owners ?? null,
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
  return s.projects.find((p) => p.root === s.currentRoot)?.parseError ?? null
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
  set({ projects })
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
    .then((architecture) => {
      if (!state.entries[root]) return
      patchEntry(root, { status: 'ready', architecture, error: null })
      if (!loaded) {
        loadEdits(root)
        loadOwners(root)
      }
    })
    .catch((err: unknown) => {
      if (!state.entries[root]) return
      patchEntry(root, { status: 'error', architecture: null, error: errorText(err) })
    })
}

export function closeProject(root: string): void {
  const entry = state.entries[root]
  if (!entry || !discardOk(entry)) return

  const entries = { ...state.entries }
  delete entries[root]
  const currentRoot = state.currentRoot === root ? Object.keys(entries)[0] ?? null : state.currentRoot
  set({ entries, currentRoot })
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
