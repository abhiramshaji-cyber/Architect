import { closeEdit, handEdit, removeEdit, saveEdit, useProject } from '../model/store'

export default function EditBar({ onAddComponent }: { onAddComponent: () => void }) {
  const { draft, dirty, busy, message } = useProject()
  if (!draft) return null

  return (
    <div className="edit-bar">
      <div className="edit-bar-label">
        Editing {draft.id} · {draft.status === 'handed' ? 'handed, read only' : 'draft'}
        {dirty && ' · unsaved changes'}
      </div>
      <div className="edit-bar-actions">
        {draft.status === 'draft' && (
          <>
            <button className="ghost" onClick={onAddComponent} disabled={busy}>
              Add component
            </button>
            <button className="primary" onClick={saveEdit} disabled={busy}>
              Save
            </button>
            <button className="hand" onClick={handEdit} disabled={busy}>
              Hand to Claude
            </button>
          </>
        )}
        <button className="ghost" onClick={closeEdit} disabled={busy}>
          Close
        </button>
        <button className="ghost" onClick={removeEdit} disabled={busy}>
          Delete edit
        </button>
      </div>
      {message && <div className={message.error ? 'edit-bar-message error' : 'edit-bar-message'}>{message.text}</div>}
    </div>
  )
}
