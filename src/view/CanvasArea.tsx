import { useCallback, useEffect, useState } from 'react'
import type { Architecture } from '../../shared/types'
import Canvas from './Canvas'
import CodeCanvas from './CodeCanvas'
import EditBar from './EditBar'
import { crumbs, parentOf, worldPath } from '../model/codemap'
import { addComponent, type OpResult } from '../model/edit-ops'
import { folderName } from '../model/layout'
import { applyEdit, loadCodeMap, parseErrorOf, pendingHere, rescan, useProject } from '../model/store'

function placeholderId(a: Architecture): string {
  const taken = new Set(a.components.map((c) => c.id))
  let n = 1
  while (taken.has(`component${n}`)) n++
  return `component${n}`
}

export default function CanvasArea({ theme }: { theme: string }) {
  const project = useProject()
  const { currentRoot, architecture, draft, codeMap, codeBusy, codeError, owners } = project
  const [mode, setMode] = useState<'contract' | 'code'>('contract')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [codePath, setCodePath] = useState('')

  useEffect(() => {
    setCodePath('')
  }, [currentRoot])

  useEffect(() => {
    setSelectedId(null)
  }, [currentRoot, mode, draft?.id, draft?.status])

  useEffect(() => {
    if (mode === 'code') loadCodeMap()
  }, [mode, currentRoot, codeMap])

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
  const parseError = parseErrorOf(project)
  const codeWorld = codeMap ? worldPath(codeMap, codePath) : ''
  const trail = crumbs(currentRoot ? folderName(currentRoot) : 'root', codeWorld)
  const goUp = useCallback(() => setCodePath(parentOf(codeWorld)), [codeWorld])

  return (
    <main className="canvas-area">
      {parseError && (
        <div className="parse-banner" role="alert">
          <strong>architect.md could not be loaded.</strong> {parseError}
        </div>
      )}
      {shown ? (
        <>
          <header className="canvas-header">
            <div className="canvas-header-top">
              <h2>{shown.title}</h2>
              <div className="mode-toggle">
                <button className={mode === 'contract' ? 'mode active' : 'mode'} onClick={() => setMode('contract')}>
                  Contract
                </button>
                <button className={mode === 'code' ? 'mode active' : 'mode'} onClick={() => setMode('code')}>
                  Code
                </button>
              </div>
            </div>
            {currentRoot && <p className="canvas-path">{currentRoot}</p>}
            <p>{mode === 'code' ? 'Every folder, file and function in this project.' : shown.summary}</p>
          </header>
          {mode === 'code' ? (
            <>
              {codeMap && (
                <div className="code-bar">
                  <button className="ghost" onClick={goUp} disabled={codeWorld === ''}>
                    Back
                  </button>
                  <nav className="crumbs">
                    {trail.map((c, i) => (
                      <span key={c.path}>
                        {i > 0 && <span className="crumb-sep">/</span>}
                        <button
                          className={c.path === codeWorld ? 'crumb current' : 'crumb'}
                          onClick={() => setCodePath(c.path)}
                        >
                          {c.label}
                        </button>
                      </span>
                    ))}
                  </nav>
                  <div className="code-bar-actions">
                    <button className="primary" onClick={rescan} disabled={codeBusy}>
                      {codeBusy ? 'Scanning…' : 'Rescan'}
                    </button>
                  </div>
                  {codeError && <div className="edit-bar-message error">{codeError}</div>}
                </div>
              )}
              {codeMap ? (
                <CodeCanvas map={codeMap} path={codeWorld} theme={theme} onEnter={setCodePath} onUp={goUp} />
              ) : (
                <div className="empty-state code-blank">
                  {codeBusy ? (
                    <p>Scanning the project. This reads every file and can take a while.</p>
                  ) : codeMap === null ? (
                    <>
                      <p>This project has not been scanned yet.</p>
                      <button className="primary" onClick={rescan}>
                        Scan project
                      </button>
                    </>
                  ) : (
                    <p>Loading the code map…</p>
                  )}
                  {codeError && <p className="code-error">{codeError}</p>}
                </div>
              )}
            </>
          ) : (
            <>
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
          )}
        </>
      ) : (
        <div className="empty-state">
          {parseError ? 'Fix architect.md to see this architecture.' : 'Select a project to open its architecture'}
        </div>
      )}
    </main>
  )
}
