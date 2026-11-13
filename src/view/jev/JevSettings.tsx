import { useState, type FormEvent } from 'react'
import type { JevRun } from '../../../shared/jev/types'
import { useProject } from '../../model/store'
import { useJev } from './useJev'

const NOTICE = 'Turning Jev on sends the source code of each function, with its name, file, signature and the names of its callers and callees, to TypeSafe for classification.'

function runText(run: JevRun | null): string {
  if (!run) return 'Not indexed yet'
  const counted = `${run.done.toLocaleString()} of ${run.total.toLocaleString()} functions classified`
  const failed = run.failed > 0 ? `, ${run.failed} failed` : ''
  const label = { running: 'Indexing', done: 'Indexed', stopped: 'Stopped', failed: 'Failed' }[run.status]
  return `${label}: ${counted}${failed}${run.error ? ` (${run.error})` : ''}`
}

export default function JevSettings() {
  const { currentRoot } = useProject()
  const { state, busy, error, act } = useJev(currentRoot)
  const [key, setKey] = useState('')

  if (!state) return null
  const save = (event: FormEvent) => {
    event.preventDefault()
    const typed = key
    setKey('')
    act(() => window.architect.setJevKey(typed))
  }

  return (
    <li className={state.enabled ? 'ai-card in-use' : 'ai-card'}>
      <div className="ai-card-head">
        <h3>Jev by TypeSafe</h3>
        <span className={state.enabled && state.key.set ? 'ai-login ready' : 'ai-login'}>{state.enabled && state.key.set ? 'On' : 'Off'}</span>
      </div>
      <p className="cv-detail">Optional. Classifies every function so the Focus view can find others with the same behavior. {state.key.set ? 'Key set.' : 'Add a TypeSafe API key to enable.'}</p>
      {!state.encryption && <p className="cv-detail">The system keychain is not available, so no key can be stored.</p>}

      <form className="ai-card-actions" onSubmit={save}>
        <input className="cyber-input" type="password" autoComplete="off" spellCheck={false} placeholder={state.key.set ? 'Replace the key' : 'TypeSafe API key'} value={key} disabled={busy || !state.encryption} onChange={(event) => setKey(event.target.value)} aria-label="TypeSafe API key" />
        <button className="ghost" type="submit" disabled={busy || key.trim() === ''}>
          {state.key.set ? 'Replace key' : 'Save key'}
        </button>
        {state.key.set && (
          <button className="ghost" type="button" disabled={busy} onClick={() => act(() => window.architect.removeJevKey())}>
            Remove key
          </button>
        )}
      </form>

      {!state.enabled && state.key.set && <p className="cv-detail">{NOTICE}</p>}
      <div className="ai-card-actions">
        {state.enabled && currentRoot && <span className="cv-detail">{runText(state.run)}</span>}
        {state.enabled && currentRoot && state.run?.status === 'running' && (
          <button className="ghost" disabled={busy} onClick={() => act(() => window.architect.cancelJev(currentRoot))}>
            Stop
          </button>
        )}
        {state.enabled && currentRoot && state.run?.status !== 'running' && (
          <button className="ghost" disabled={busy} onClick={() => act(() => window.architect.indexJev(currentRoot))}>
            Index again
          </button>
        )}
        <button className={state.enabled ? 'ghost' : 'primary'} disabled={busy || (!state.enabled && !state.key.set)} onClick={() => act(() => window.architect.setJev(!state.enabled, currentRoot ?? undefined))}>
          {state.enabled ? 'Turn off' : 'Turn on'}
        </button>
      </div>
      {error && <p className="fn-notice" role="status">{error}</p>}
    </li>
  )
}
