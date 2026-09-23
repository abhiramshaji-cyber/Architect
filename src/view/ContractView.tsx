import { useCallback, useEffect, useState } from 'react'
import type { Architecture } from '../../shared/types'
import Canvas from './Canvas'
import EditBar from './EditBar'
import { addComponent, type OpResult } from '../model/edit-ops'
import { applyEdit, createContract, loadErrorOf, parseErrorOf, pendingHere, useProject } from '../model/store'
import type { ViewProps } from '../shell/views'

function placeholderId(a: Architecture): string {
  const taken = new Set(a.components.map((c) => c.id))
  let n = 1
  while (taken.has(`component${n}`)) n++
  return `component${n}`
}

export default function ContractView({ theme }: ViewProps) {
  const project = useProject()
  const { currentRoot, architecture, contract, draft, owners, busy } = project
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

    return (
      <div className="empty-state">
        <p>This project has no architect.md yet, so there is no contract to draw.</p>
        <p>Start one from the folders Architect scanned, then say what each component is for.</p>
        <button className="primary" onClick={createContract} disabled={busy}>
          Create architect.md
        </button>
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
