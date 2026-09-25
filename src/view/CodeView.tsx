import { useCallback, useEffect, useState } from 'react'
import CodeCanvas from './CodeCanvas'
import { crumbs, parentOf, worldPath } from '../model/codemap'
import { folderName } from '../model/layout'
import { loadCodeMap, rescan, useProject } from '../model/store'
import type { ViewProps } from '../shell/views'

export default function CodeView({ theme }: ViewProps) {
  const { currentRoot, architecture, draft, codeMap, codeBusy, codeError } = useProject()
  const [codePath, setCodePath] = useState('')

  useEffect(() => {
    setCodePath('')
  }, [currentRoot])

  useEffect(() => {
    loadCodeMap()
  }, [currentRoot, codeMap])

  const shown = draft ? draft.architecture : architecture
  const codeWorld = codeMap ? worldPath(codeMap, codePath) : ''
  const trail = crumbs(currentRoot ? folderName(currentRoot) : 'root', codeWorld)
  const goUp = useCallback(() => setCodePath(parentOf(codeWorld)), [codeWorld])

  if (!currentRoot) return <div className="empty-state">Select a project to open its code map</div>

  return (
    <>
      <header className="canvas-header">
        <h2>{shown ? shown.title : folderName(currentRoot)}</h2>
        <p className="canvas-path">{currentRoot}</p>
        <p>Every folder, file and function in this project.</p>
      </header>

      {codeMap && (
        <div className="code-bar">
          <button className="ghost" onClick={goUp} disabled={codeWorld === ''}>
            Back
          </button>
          <nav className="crumbs">
            {trail.map((c, i) => (
              <span key={c.path}>
                {i > 0 && <span className="crumb-sep">/</span>}
                <button className={c.path === codeWorld ? 'crumb current' : 'crumb'} onClick={() => setCodePath(c.path)}>
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
  )
}
