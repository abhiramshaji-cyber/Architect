import { useEffect, useRef, useState } from 'react'
import Editor from './Editor'
import { useNavigator } from './editor/useNavigator'
import FileTree from './FileTree'
import SearchPanel from './search/SearchPanel'
import { isDirty, refusalOf } from '../model/buffer'
import { closeFile, editFile, loadCodeMap, openFile, reloadFile, revertFile, saveFile, useProject } from '../model/store'

export default function FilesView() {
  const { currentRoot, file, fileLine, fileBusy, fileNotice, touched, codeMap } = useProject()
  const dirty = isDirty(file)
  const pane = useRef<HTMLDivElement | null>(null)
  const { onAction, quickOpen, overlay } = useNavigator(currentRoot, file?.path ?? null, codeMap)
  const open = useRef(quickOpen)
  const [searching, setSearching] = useState(false)

  open.current = quickOpen

  useEffect(() => {
    loadCodeMap()
  }, [currentRoot, codeMap])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      if (e.shiftKey) {
        if (e.code !== 'KeyF' || !pane.current?.contains(document.activeElement)) return
        e.preventDefault()
        setSearching(true)
      } else if (e.key === 's') {
        e.preventDefault()
        saveFile()
      } else if (e.key === 'p' && pane.current?.contains(document.activeElement)) {
        e.preventDefault()
        open.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!currentRoot) return null

  return (
    <div className="files" ref={pane}>
      {searching ? (
        <SearchPanel onClose={() => setSearching(false)} />
      ) : (
        <FileTree root={currentRoot} current={file?.path ?? null} touched={touched} onOpen={openFile} />
      )}

      <div className="files-pane">
        {file === null ? (
          <div className="empty-state">{fileBusy ? 'Opening…' : 'No file open'}</div>
        ) : (
          <>
            <div className="files-bar">
              <span className="files-path">
                {file.path}
                {dirty && <span className="files-dot" aria-label="unsaved changes" />}
              </span>
              {fileNotice && (
                <span className={fileNotice.error ? 'files-notice error' : 'files-notice'} role="status">
                  {fileNotice.text}
                </span>
              )}
              <div className="files-actions">
                <button className="primary" onClick={saveFile} disabled={!dirty || fileBusy}>
                  {fileBusy ? 'Saving…' : 'Save'}
                </button>
                <button className="ghost" onClick={revertFile} disabled={!dirty}>
                  Revert
                </button>
                <button className="ghost" onClick={reloadFile} disabled={fileBusy}>
                  Reload
                </button>
                <button className="ghost" onClick={closeFile}>
                  Close
                </button>
              </div>
            </div>

            {file.error !== null ? (
              <div className="empty-state">{refusalOf(file.error)}</div>
            ) : (
              <Editor
                path={file.path}
                text={file.draft}
                line={fileLine}
                editable={!fileBusy}
                onChange={editFile}
                onAction={(action, view) => (action === 'search' ? setSearching(true) : onAction(action, view))}
              />
            )}
          </>
        )}
      </div>

      {overlay}
    </div>
  )
}
