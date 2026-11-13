import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import type { Architecture, DraftFailure } from '../../../shared/types'
import { draftMessage } from '../../model/picker'
import { AiText } from '../ai/AiText'
import { summariesOff } from '../ai/login'
import { useAi } from '../ai/useAi'
import { applyAction, DEFAULT_VIEW, type ViewState } from './action'

type Said = { asker: boolean; text: string; notes?: string[]; error?: string }

type ChatProps = {
  root: string | null
  architecture: Architecture | null
  view: ViewState
  onView: (view: ViewState) => void
  onOpenAi: () => void
}

function failureText(failure: DraftFailure): string {
  if (failure.kind === 'nothing-to-draft') return 'There is no diagram or question to ask about'
  if (failure.kind === 'unusable') return `The AI replied with something unusable (${failure.detail}), so the view was left alone`
  return draftMessage(failure)
}

export default function ChatPanel({ root, architecture, view, onView, onOpenAi }: ChatProps) {
  const { state } = useAi()
  const off = summariesOff(state)
  const [open, setOpen] = useState(true)
  const [said, setSaid] = useState<Said[]>([])
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState(false)
  const current = useRef(view)
  const live = useRef(true)

  current.current = view

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const add = (line: Said) => live.current && setSaid((now) => [...now, line])

  async function ask(event?: FormEvent) {
    event?.preventDefault()
    const asked = question.trim()
    if (!root || !architecture || asked === '' || pending) return

    const turns = said.filter((s) => !s.error).map(({ asker, text }) => ({ asker, text }))
    setSaid((now) => [...now, { asker: true, text: asked }])
    setQuestion('')
    setPending(true)

    try {
      const result = await window.architect.askContract(root, asked, turns, current.current)
      if (!result.ok) return add({ asker: false, text: '', error: failureText(result.error) })

      const applied = applyAction(current.current, result.value.view, architecture)
      if (live.current && applied.view !== current.current) onView(applied.view)
      add({ asker: false, text: result.value.text, notes: applied.notes })
    } catch (err) {
      add({ asker: false, text: '', error: err instanceof Error ? err.message : String(err) })
    } finally {
      if (live.current) setPending(false)
    }
  }

  const enter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void ask()
  }

  const shaped = JSON.stringify(view) !== JSON.stringify(DEFAULT_VIEW)

  return (
    <div className="rail-section chat-panel">
      <div className="rail-head">
        <h2>Ask AI</h2>
        <div className="chat-actions">
          {shaped && (
            <button className="cyber-btn cyber-btn--sm cyber-btn--ghost" onClick={() => onView(DEFAULT_VIEW)}>
              Reset view
            </button>
          )}
          <button className="cyber-btn cyber-btn--sm cyber-btn--ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {open && off && (
        <p className="chat-hint">
          {off}. Connect one on the AI page.{' '}
          <button className="cyber-btn cyber-btn--sm cyber-btn--ghost" onClick={onOpenAi}>
            AI settings
          </button>
        </p>
      )}

      {open && state && !off && (
        <>
          <ol className="chat-log" aria-live="polite">
            {said.map((line, i) => (
              <li key={i} className={line.asker ? 'chat-line asker' : 'chat-line'}>
                {line.asker && <p className="chat-q">{line.text}</p>}
                {!line.asker && <AiText as="p" className="chat-a" text={line.text} />}
                {line.notes?.map((note) => (
                  <p key={note} className="chat-note">
                    {note}
                  </p>
                ))}
                {line.error && (
                  <p className="chat-error" role="alert">
                    {line.error}
                  </p>
                )}
              </li>
            ))}
            {pending && (
              <li className="chat-line chat-pending" role="status">
                <span className="drafting-pulse" aria-hidden="true" /> Thinking
              </li>
            )}
          </ol>

          <form className="chat-form" onSubmit={ask}>
            <textarea
              className="chat-input"
              rows={2}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={enter}
              placeholder="Ask what the diagram means, or how to show it"
              aria-label="Ask the AI about this diagram"
            />
            <button type="submit" className="cyber-btn cyber-btn--sm" disabled={pending || question.trim() === '' || !architecture}>
              Ask
            </button>
          </form>
        </>
      )}
    </div>
  )
}
