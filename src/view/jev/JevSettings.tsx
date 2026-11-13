import { useState, type FormEvent } from 'react'
import type { JevBudget, JevRun, JevUsage } from '../../../shared/jev/types'
import { useProject } from '../../model/store'
import { useJev } from './useJev'

const NOTICE = 'Turning Jev on sends the source code of each function, with its name, file, signature and the names of its callers and callees, to TypeSafe for classification.'

const LABELS: Record<JevRun['status'], string> = { queued: 'Queued behind another project', running: 'Indexing', done: 'Indexed', partial: 'Indexed with failures', paused: 'Paused', stopped: 'Stopped', failed: 'Failed' }

const RETRIED: JevRun['status'][] = ['partial', 'paused', 'stopped', 'failed']

const dollars = (cost: number) => cost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cost < 1 ? 4 : 2 })

function runText(run: JevRun | null): string {
  if (!run) return 'Not indexed yet'
  const counted = `${run.done.toLocaleString()} of ${run.total.toLocaleString()} functions classified`
  const failed = run.failed > 0 ? `, ${run.failed} failed and will be retried` : ''
  return `${LABELS[run.status]}: ${counted}${failed}${run.error ? ` (${run.error})` : ''}`
}

function usageText(usage: JevUsage): string {
  return `${usage.indexed.toLocaleString()} functions indexed, ${usage.tokens.toLocaleString()} input tokens used, about ${dollars(usage.cost)}`
}

function budgetText(budget: JevBudget): string {
  const spent = `This month: ${budget.tokens.toLocaleString()} input tokens, about ${dollars(budget.cost)}`
  return budget.limit === null ? `${spent}, no budget set.` : `${spent}, of a budget of ${budget.limit.toLocaleString()}.`
}

export default function JevSettings() {
  const { currentRoot } = useProject()
  const { state, busy, error, act } = useJev(currentRoot)
  const [key, setKey] = useState('')
  const [limit, setLimit] = useState('')

  if (!state) return null
  const save = (event: FormEvent) => {
    event.preventDefault()
    const typed = key
    setKey('')
    act(() => window.architect.setJevKey(typed))
  }
  const saveBudget = (event: FormEvent) => {
    event.preventDefault()
    const typed = limit.trim()
    setLimit('')
    act(() => window.architect.setJevBudget(typed === '' ? null : Number(typed)))
  }
  const retry = Boolean(state.paused) || (state.run !== null && RETRIED.includes(state.run.status))

  return (
    <li className={state.enabled ? 'ai-card in-use' : 'ai-card'}>
      <div className="ai-card-head">
        <h3>Jev by TypeSafe</h3>
        <span className={state.enabled && state.key.set && !state.paused ? 'ai-login ready' : 'ai-login'}>{state.paused ? 'Paused' : state.enabled && state.key.set ? 'On' : 'Off'}</span>
      </div>
      <p className="cv-detail">Optional. Classifies every function so the Focus view can find others with the same behavior. {state.key.set ? 'Key set.' : 'Add a TypeSafe API key to enable.'}</p>
      {!state.encryption && <p className="cv-detail">The system keychain is not available, so no key can be stored.</p>}
      {state.paused && (
        <p className="fn-notice" role="alert">
          {state.paused}
        </p>
      )}

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

      {currentRoot && state.usage && (state.usage.requests > 0 || state.usage.indexed > 0) && <p className="cv-detail">{usageText(state.usage)}</p>}
      {state.key.set && (
        <form className="ai-card-actions" onSubmit={saveBudget}>
          <span className="cv-detail">{budgetText(state.budget)}</span>
          <input className="cyber-input" type="number" min={1} step={1} inputMode="numeric" placeholder={state.budget.limit === null ? 'Monthly token budget' : 'New budget, empty for none'} value={limit} disabled={busy} onChange={(event) => setLimit(event.target.value)} aria-label="Monthly input token budget" />
          <button className="ghost" type="submit" disabled={busy || (limit.trim() === '' && state.budget.limit === null)}>
            {limit.trim() === '' && state.budget.limit !== null ? 'Remove budget' : 'Set budget'}
          </button>
        </form>
      )}
      {!state.enabled && state.key.set && <p className="cv-detail">{NOTICE}</p>}
      <div className="ai-card-actions">
        {state.enabled && currentRoot && <span className="cv-detail">{runText(state.run)}</span>}
        {state.enabled && currentRoot && (state.run?.status === 'running' || state.run?.status === 'queued') && (
          <button className="ghost" disabled={busy} onClick={() => act(() => window.architect.cancelJev(currentRoot))}>
            Stop
          </button>
        )}
        {state.enabled && (currentRoot || state.paused) && state.run?.status !== 'running' && state.run?.status !== 'queued' && (
          <button className="ghost" disabled={busy} onClick={() => act(() => window.architect.indexJev(currentRoot ?? ''))}>
            {retry ? 'Retry' : 'Index again'}
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
