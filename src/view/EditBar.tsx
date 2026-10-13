import { closeEdit, handEdit, removeEdit, saveEdit, useProject } from '../model/store'

export default function EditBar({ onAddComponent }: { onAddComponent: () => void }) {
  const { draft, dirty, busy, message } = useProject()
  if (!draft) return null

  return (
    <div className="edit-bar">
      <div className="edit-bar-label">
        <strong>{draft.id}</strong> · {draft.status === 'handed' ? 'read only' : 'draft'}
        {dirty && ' · unsaved'}
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
            <button onClick={handEdit} disabled={busy}>
              Hand to Claude
            </button>
          </>
        )}
        <button className="ghost" onClick={closeEdit} disabled={busy}>
          Close
        </button>
        <button className="ghost" onClick={removeEdit} disabled={busy}>
          Delete
        </button>
      </div>
      {message && <div className={message.error ? 'edit-bar-message error' : 'edit-bar-message'}>{message.text}</div>}
    </div>
  )
}
