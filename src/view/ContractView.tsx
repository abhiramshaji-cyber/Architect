import { useCallback, useEffect, useState } from 'react'
import type { Architecture, DraftFailure } from '../../shared/types'
import Canvas from './Canvas'
import EditBar from './EditBar'
import { addComponent, type OpResult } from '../model/edit-ops'
import {
  applyEdit,
  createContract,
  draftContract,
  loadErrorOf,
  parseErrorOf,
  pendingHere,
  useProject,
} from '../model/store'
import type { ViewProps } from '../shell/views'

function placeholderId(a: Architecture): string {
  const taken = new Set(a.components.map((c) => c.id))
  let n = 1
  while (taken.has(`component${n}`)) n++
  return `component${n}`
}

function draftNote(failure: DraftFailure): string {
  if (failure.kind === 'not-installed') return 'Claude Code is not on your PATH, so there is nobody to ask yet.'
  if (failure.kind === 'nothing-to-draft') return 'Architect found no source it recognises here, so there is nothing to draft from.'
  if (failure.kind === 'timed-out') return 'Claude took too long to answer, so nothing was drafted.'
  if (failure.kind === 'unusable') return `Claude replied with something that is not a contract, so nothing was drafted (${failure.detail}).`
  return `Claude could not finish the draft${failure.stderr ? ` (${failure.stderr})` : ''}.`
}

export default function ContractView({ theme }: ViewProps) {
  const project = useProject()
  const { currentRoot, architecture, contract, draft, owners, busy, drafting, draftError } = project
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    setSelectedId(null)
  }, [currentRoot, draft?.id, draft?.status])

  const edit = useCallback((op: (a: Architecture) => OpResult) => {
    const next = applyEdit(op)
    if (!next) return false
    setSelectedId((id) => (id !== null && next.components.some((c) => c.id === id) ? id : null))
    return true
  }, [])

  const addAndSelect = useCallback(() => {
    if (!draft) return
    const id = placeholderId(draft.architecture)
    if (!edit((a) => addComponent(a, id))) return
    setSelectedId(id)

    requestAnimationFrame(() => {
      const field = document.getElementById('inspector-id-input')
      if (!(field instanceof HTMLInputElement)) return
      field.focus()
      field.select()
    })
  }, [draft, edit])

  const shown = draft ? draft.architecture : architecture

  if (!shown) {
    const loadError = loadErrorOf(project)
    if (loadError) return <div className="empty-state">{loadError}</div>
    if (parseErrorOf(project)) return <div className="empty-state">Fix architect.md to see this architecture.</div>
    if (!currentRoot) return <div className="empty-state">Select a project to open its architecture</div>
    if (contract?.status !== 'missing') return <div className="empty-state">Opening this project…</div>

    const waiting = pendingHere(project).some((p) => p.proposal.kind === 'contract')

    return (
      <div className="empty-state blank-contract">
        <h2>No architect.md here yet</h2>
        <p>
          Write a starter contract from the folders Architect scanned, or have Claude draft one from the code. Nothing
          is written until you approve it.
        </p>

        <div className="blank-actions">
          <button className="primary" onClick={createContract} disabled={busy || drafting}>
            Create architect.md
          </button>
          <button onClick={draftContract} disabled={busy || drafting}>
            Ask Claude to draft one
          </button>
        </div>

        {drafting && <p className="blank-note">Claude is reading the code and writing a draft.</p>}
        {!drafting && waiting && <p className="blank-note">Claude's draft is waiting in the approval inbox.</p>}
        {!drafting && draftError && <p className="blank-note">{draftNote(draftError)} You can still write one yourself.</p>}
      </div>
    )
  }

  return (
    <>
      <header className="canvas-header">
        <h2>{shown.title}</h2>
        {currentRoot && <p className="canvas-path">{currentRoot}</p>}
        <p>{shown.summary}</p>
      </header>

      <EditBar onAddComponent={addAndSelect} />

      <Canvas
        key={draft ? `${currentRoot}:${draft.id}:${draft.status}` : currentRoot}
        architecture={shown}
        ownership={draft ? null : owners}
        pending={draft ? [] : pendingHere(project)}
        theme={theme}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onEdit={draft && draft.status === 'draft' ? edit : undefined}
      />
    </>
  )
}
