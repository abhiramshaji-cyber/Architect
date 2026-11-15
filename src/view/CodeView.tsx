import { useCallback, useEffect, useState } from 'react'
import AiStatus from './ai/AiStatus'
import CodeCanvas from './CodeCanvas'
import { crumbs, parentOf, worldPath } from '../model/codemap'
import { folderName } from '../model/layout'
import { loadCodeMap, rescan, useProject } from '../model/store'
import type { ViewProps } from '../shell/views'
import { keep, recall } from './remember/slot'

export default function CodeView({ theme, show }: ViewProps) {
  const { currentRoot, architecture, draft, codeMap, codeBusy, codeError } = useProject()
  const [codePath, setCodePath] = useState(() => recall('code', 'folder', currentRoot) ?? '')
  const [picked, setPicked] = useState(() => recall('code', 'selected', currentRoot))

  useEffect(() => {
    setCodePath(recall('code', 'folder', currentRoot) ?? '')
    setPicked(recall('code', 'selected', currentRoot))
  }, [currentRoot])

  const enter = useCallback(
    (next: string) => {
      setCodePath(next)
      keep('code', 'folder', currentRoot, next)
    },
    [currentRoot],
  )
  const select = useCallback(
    (id: string | null) => {
      setPicked(id)
      keep('code', 'selected', currentRoot, id)
    },
    [currentRoot],
  )

  useEffect(() => {
    loadCodeMap()
  }, [currentRoot, codeMap])

  const shown = draft ? draft.architecture : architecture
  const codeWorld = codeMap ? worldPath(codeMap, codePath) : ''
  const trail = crumbs(currentRoot ? folderName(currentRoot) : 'root', codeWorld)
  const goUp = useCallback(() => enter(parentOf(codeWorld)), [enter, codeWorld])

  if (!currentRoot) return null

  return (
    <>
      <header className="canvas-header">
        <h2>{shown ? shown.title : folderName(currentRoot)}</h2>
        <p className="canvas-path">{currentRoot}</p>
      </header>

      {codeMap && (
        <div className="code-bar" data-folder={codeWorld}>
          <button className="cyber-btn cyber-btn--sm cyber-btn--ghost" onClick={goUp} disabled={codeWorld === ''}>
            Back
          </button>
          <nav className="crumbs">
            {trail.map((c, i) => (
              <span key={c.path}>
                {i > 0 && <span className="crumb-sep">/</span>}
                <button className={c.path === codeWorld ? 'crumb current' : 'crumb'} onClick={() => enter(c.path)}>
                  {c.label}
                </button>
              </span>
            ))}
          </nav>
          <div className="code-bar-actions">
            <button className="cyber-btn cyber-btn--sm cyber-btn--filled" onClick={rescan} disabled={codeBusy}>
              {codeBusy ? 'Scanning…' : 'Rescan'}
            </button>
          </div>
          {codeError && <div className="edit-bar-message error">{codeError}</div>}
        </div>
      )}
      {codeMap && <AiStatus stamp={codeMap} onOpen={() => show('ai')} />}

      {codeMap ? (
        <CodeCanvas map={codeMap} path={codeWorld} theme={theme} selectedId={picked} onSelect={select} onEnter={enter} onUp={goUp} />
      ) : (
        <div className="empty-state code-blank">
          {codeBusy ? (
            <p>Scanning…</p>
          ) : codeMap === null ? (
            <>
              <p>Not scanned</p>
              <button className="cyber-btn cyber-btn--sm cyber-btn--filled" onClick={rescan}>
                Scan
              </button>
            </>
          ) : (
            <p>Loading…</p>
          )}
          {codeError && <p className="code-error">{codeError}</p>}
        </div>
      )}
    </>
  )
}
