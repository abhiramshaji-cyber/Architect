import { newEdit, openEdit, useProject } from '../model/store'
import Icon from './Icon'

export default function EditList() {
  const { edits, draft, currentRoot, architecture, busy } = useProject()

  return (
    <div className="rail-section">
      <div className="rail-head">
        <h2>Edits</h2>
        <button
          className="icon-button"
          onClick={newEdit}
          disabled={!currentRoot || !architecture || busy}
          aria-label="New edit"
          title="New edit"
        >
          <Icon name="plus" />
        </button>
      </div>
      <ul className="edits-list">
        {edits.map((e) => (
          <li key={e.id}>
            <button
              className={draft && draft.id === e.id ? 'edit-item active' : 'edit-item'}
              onClick={() => openEdit(e.id)}
              disabled={e.error !== undefined || busy}
            >
              <span>{e.title === '' ? e.id : e.title}</span>
              <span className={`edit-status ${e.status}`}>{e.status}</span>
            </button>
            {e.error !== undefined && <div className="edit-error">{e.error}</div>}
          </li>
        ))}
      </ul>
    </div>
  )
}
