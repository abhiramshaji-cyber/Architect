import type { CliStatus } from '../../../shared/settings'
import { CLI_NAMES } from '../../model/picker'
import { loginText } from './login'
import { chooseAi, refreshAi, useAi } from './useAi'

const USES = 'Function summaries on the Code page and the Inspector, each marked AI, the contract draft, commit messages, pull requests and conventions suggestions.'

export default function AiView() {
  const { state, busy, error } = useAi()
  const choice = state?.choice

  const card = (cli: CliStatus) => {
    if (!choice) return null
    const name = CLI_NAMES[cli.provider]
    const model = choice.models[cli.provider]
    const inUse = choice.connected && choice.provider === cli.provider
    const options = cli.models.includes(model) ? cli.models : [model, ...cli.models]

    return (
      <li key={cli.provider} className={inUse ? 'ai-card in-use' : 'ai-card'}>
        <div className="ai-card-head">
          <h3>{name}</h3>
          <span className={cli.login === 'ready' ? 'ai-login ready' : 'ai-login'}>{cli.login === 'ready' ? 'Ready' : 'Not ready'}</span>
        </div>
        <p className="cv-detail">{loginText(cli)}</p>
        <div className="ai-card-actions">
          <label className="ai-model">
            Model
            <select className="cyber-select" value={model} disabled={busy} onChange={(event) => chooseAi({ ...choice, models: { ...choice.models, [cli.provider]: event.target.value } })}>
              {options.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <button className={inUse ? 'ghost' : 'primary'} disabled={busy || inUse || cli.login !== 'ready'} onClick={() => chooseAi({ ...choice, connected: true, provider: cli.provider })}>
            {inUse ? 'In use' : `Use ${name}`}
          </button>
        </div>
      </li>
    )
  }

  return (
    <section className="conventions">
      <header className="canvas-header">
        <h2>AI</h2>
        <p className="canvas-path">Runs through the Claude Code or Codex CLI already signed in on this machine. Architect never uses an API key.</p>
      </header>

      <div className="fn-bar">
        <p className="fn-count" aria-live="polite">
          {!choice ? 'Checking…' : choice.connected ? `Connected to ${CLI_NAMES[choice.provider]}, ${choice.models[choice.provider]}` : 'No AI connected'}
        </p>
        <button className="cyber-btn cyber-btn--sm cyber-btn--ghost" disabled={busy} onClick={refreshAi}>
          {busy ? 'Checking…' : 'Check again'}
        </button>
        {choice?.connected && (
          <button className="cyber-btn cyber-btn--sm cyber-btn--ghost" disabled={busy} onClick={() => chooseAi({ ...choice, connected: false })}>
            Disconnect
          </button>
        )}
      </div>

      {error && (
        <p className="fn-notice" role="status">
          {error}
        </p>
      )}

      <ol className="cv-list">{state?.clis.map(card)}</ol>

      <h3 className="cv-heading">What uses it</h3>
      <p className="cv-note">{USES} The Functions page and the Tree only ever show facts read from the code, never AI text.</p>
    </section>
  )
}
