import { useState } from 'react'
import { decide } from '../../model/review'

export default function Actions({ id }: { id: string }) {
  const [feedback, setFeedback] = useState('')
  const [writing, setWriting] = useState(false)
  const said = feedback.trim()

  const send = () => {
    if (said) decide(id, false, said)
  }

  return (
    <div className="review-actions">
      <div className="review-buttons">
        <button className="cyber-btn cyber-btn--sm cyber-btn--filled" onClick={() => decide(id, true)}>
          Approve
        </button>
        <button className="cyber-btn cyber-btn--sm" onClick={() => decide(id, false)}>Deny</button>
        <button aria-expanded={writing} onClick={() => setWriting((open) => !open)}>
          Suggest a better way
        </button>
      </div>

      {writing && (
        <form
          className="review-feedback"
          onSubmit={(event) => {
            event.preventDefault()
            send()
          }}
        >
          <textarea className="cyber-textarea"
            autoFocus
            rows={3}
            value={feedback}
            placeholder="A better way is…"
            aria-label="Feedback for Claude"
            onChange={(event) => setFeedback(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
              event.preventDefault()
              send()
            }}
          />
          <button className="cyber-btn cyber-btn--sm" type="submit" disabled={!said}>
            Deny and tell Claude
          </button>
        </form>
      )}
    </div>
  )
}
