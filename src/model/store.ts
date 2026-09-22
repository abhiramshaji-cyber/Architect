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

export type ProjectState = {
  projects: ProjectSummary[]
  currentRoot: string | null
  architecture: Architecture | null
  pending: Pending[]
  reassign: Record<string, string>
  edits: EditSummary[]
  draft: Edit | null
  dirty: boolean
  busy: boolean
  message: { text: string; error: boolean } | null
  codeMap: CodeMap | null | undefined
  codeBusy: boolean
  codeError: string | null
  owners: Ownership | null
}

let state: ProjectState = {
  projects: [],
  currentRoot: null,
  architecture: null,
  pending: [],
  reassign: {},
  edits: [],
  draft: null,
  dirty: false,
  busy: false,
  message: null,
  codeMap: undefined,
  codeBusy: false,
  codeError: null,
  owners: null,
}

const listeners = new Set<() => void>()

function set(patch: Partial<ProjectState>): void {
  state = { ...state, ...patch }
  for (const listen of listeners) listen()
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

export function parseErrorOf(s: ProjectState): string | null {
  return s.projects.find((p) => p.root === s.currentRoot)?.parseError ?? null
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

async function run(fn: () => Promise<void>): Promise<void> {
  set({ busy: true })
  try {
    await fn()
  } catch (err) {
    fail(err)
  } finally {
    set({ busy: false })
  }
}

function discardOk(): boolean {
  return !state.dirty || confirm('This edit has unsaved changes. Discard them?')
}

let started = false

export function start(): void {
  if (started) return
  started = true

  window.architect.projects().then(loadedProjects)
  window.architect.pending().then(loadedPending)
  window.architect.onChange((a) => {
    set({ architecture: a })
    loadOwners()
  })
  window.architect.onPending(loadedPending)
  window.architect.onProjects(loadedProjects)
}

function loadedProjects(projects: ProjectSummary[]): void {
  set({ projects })
  autoOpen()
}

function loadedPending(pending: Pending[]): void {
  set({ pending })
  autoOpen()
}

function autoOpen(): void {
  if (state.currentRoot) return
  const root = state.pending[0]?.projectRoot ?? state.projects[0]?.root
  if (root) openProject(root)
}

export function openProject(root: string): void {
  if (state.busy || !discardOk()) return
  void window.architect.open(root).then((architecture) => {
    set({
      architecture,
      currentRoot: root,
      draft: null,
      dirty: false,
      message: null,
      codeMap: undefined,
      codeBusy: false,
      codeError: null,
    })
    loadEdits()
    loadOwners()
  })
}

function loadEdits(): void {
  const root = state.currentRoot
  if (!root) {
    set({ edits: [] })
    return
  }
  window.architect
    .edits(root)
    .then((edits) => {
      if (state.currentRoot === root) set({ edits })
    })
    .catch((err: unknown) => {
      if (state.currentRoot === root) fail(err)
    })
}

function loadOwners(): void {
  const root = state.currentRoot
  if (!root) {
    set({ owners: null })
    return
  }
  window.architect
    .ownership(root)
    .then((owners) => {
      if (state.currentRoot === root) set({ owners })
    })
    .catch(() => {
      if (state.currentRoot === root) set({ owners: null })
    })
}

export function loadCodeMap(): void {
  const root = state.currentRoot
  if (!root || state.codeMap !== undefined || state.codeBusy) return
  set({ codeBusy: true })
  window.architect
    .getCodeMap(root)
    .then((codeMap) => {
      if (state.currentRoot !== root) return
      set({ codeMap, codeBusy: false })
      loadOwners()
    })
    .catch((err: unknown) => {
      if (state.currentRoot !== root) return
      set({ codeError: errorText(err), codeBusy: false })
    })
}

export function rescan(): void {
  const root = state.currentRoot
  if (!root || state.codeBusy) return
  set({ codeBusy: true, codeError: null })
  window.architect
    .rescan(root)
    .then((codeMap) => {
      if (state.currentRoot !== root) return
      set({ codeMap, codeBusy: false })
      loadOwners()
    })
    .catch((err: unknown) => {
      if (state.currentRoot !== root) return
      set({ codeError: errorText(err), codeBusy: false })
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
  const architecture = state.architecture
  if (!root || !architecture || state.busy || !discardOk()) return
  void run(async () => {
    const draft = await window.architect.createEdit(root, architecture)
    set({ draft, dirty: false, message: null })
    set({ edits: await window.architect.edits(root) })
  })
}

export function openEdit(id: string): void {
  const root = state.currentRoot
  if (!root || state.busy || !discardOk()) return
  void run(async () => {
    const draft = await window.architect.edit(root, id)
    set({ draft, dirty: false, message: null })
  })
}

export function applyEdit(op: (a: Architecture) => OpResult): Architecture | null {
  const draft = state.draft
  if (!draft || draft.status === 'handed') return null
  const result = op(draft.architecture)
  if (!result.ok) {
    set({ message: { text: result.error, error: true } })
    return null
  }

  set({ draft: { ...draft, architecture: result.architecture }, dirty: true, message: null })
  return result.architecture
}

export function saveEdit(): void {
  const root = state.currentRoot
  const draft = state.draft
  if (!root || !draft || draft.status === 'handed' || state.busy) return
  void run(async () => {
    const saved = await window.architect.updateEdit(root, draft.id, draft.architecture)
    set({ draft: saved, dirty: false, message: { text: 'Saved', error: false } })
    set({ edits: await window.architect.edits(root) })
  })
}

export function handEdit(): void {
  const root = state.currentRoot
  const draft = state.draft
  if (!root || !draft || draft.status === 'handed' || state.busy) return
  const warning = state.dirty ? ' Unsaved changes will not be included.' : ''
  if (!confirm(`Hand edit ${draft.id} to Claude? It becomes permanently read only.${warning}`)) return
  void run(async () => {
    const handed = await window.architect.handEdit(root, draft.id)
    set({
      draft: handed,
      dirty: false,
      message: { text: 'Handed to Claude. This edit is now read only.', error: false },
    })
    set({ edits: await window.architect.edits(root) })
  })
}

export function removeEdit(): void {
  const root = state.currentRoot
  const draft = state.draft
  if (!root || !draft || state.busy) return
  if (!confirm(`Delete the whole edit ${draft.id} and every change in it? This cannot be undone.`)) return
  void run(async () => {
    await window.architect.deleteEdit(root, draft.id)
    set({ draft: null, dirty: false, message: null })
    set({ edits: await window.architect.edits(root) })
  })
}

export function closeEdit(): void {
  if (state.busy || !discardOk()) return
  set({ draft: null, dirty: false, message: null })
}
