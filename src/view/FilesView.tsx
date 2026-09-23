import { useEffect } from 'react'
import Editor from './Editor'
import FileTree from './FileTree'
import { isDirty, refusalOf } from '../model/buffer'
import { closeFile, editFile, openFile, reloadFile, revertFile, saveFile, useProject } from '../model/store'

export default function FilesView() {
  const { currentRoot, file, fileLine, fileBusy, fileNotice } = useProject()
  const dirty = isDirty(file)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 's' || !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      saveFile()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!currentRoot) return <div className="empty-state">Select a project to browse its files</div>

  return (
    <div className="files">
      <FileTree root={currentRoot} current={file?.path ?? null} onOpen={openFile} />

      <div className="files-pane">
        {file === null ? (
          <div className="empty-state">{fileBusy ? 'Opening…' : 'Select a file to read or edit it'}</div>
        ) : file.error !== null ? (
          <div className="empty-state">{refusalOf(file.error)}</div>
        ) : (
          <>
            <div className="files-bar">
              <span className="files-path">
                {file.path}
                {dirty && <span className="files-dot" aria-label="unsaved changes" />}
              </span>
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

            {fileNotice && (
              <div className={fileNotice.error ? 'edit-bar-message error' : 'edit-bar-message'}>{fileNotice.text}</div>
            )}

            <Editor
              path={file.path}
              text={file.draft}
              line={fileLine}
              editable={!fileBusy}
              onChange={editFile}
            />
          </>
        )}
      </div>
    </div>
  )
}
