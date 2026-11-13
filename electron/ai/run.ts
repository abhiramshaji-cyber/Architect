import path from 'node:path'
import { type AiFailure, type Provider, readSettings } from '../../shared/settings'
import type { DraftFailure } from '../../shared/types'
import { type CliOutput, cliOf } from './cli'
import { loginOf } from './status'

const TIMEOUT_MS = 5 * 60 * 1000
const MAX_STDERR = 600

export type AiOutput = { code: CliOutput['code'] | 'logged-out' | 'not-connected'; stdout: string; stderr: string; cli: Provider }

export type AiRun = (prompt: string, cwd: string, timeoutMs?: number, signal?: AbortSignal) => Promise<AiOutput>

const ARGS: Record<Provider, (model: string, cwd: string) => string[]> = {
  claude: (model) => ['--print', '--model', model, '--no-session-persistence', '--strict-mcp-config', '--settings', '{"disableAllHooks":true}'],
  codex: (model, cwd) => ['exec', '--model', model, '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--color', 'never', '--cd', cwd, '-'],
}

export let lastFailure: AiFailure | null = null

export function failureOf(out: AiOutput): DraftFailure | null {
  const stderr = out.stderr.trim().slice(-MAX_STDERR)
  if (out.code === 'not-connected') return { kind: 'not-connected' }
  if (out.code === 'missing') return { kind: 'not-installed', cli: out.cli }
  if (out.code === 'logged-out') return { kind: 'logged-out', cli: out.cli, detail: stderr }
  if (out.code === 'timeout') return { kind: 'timed-out', cli: out.cli }
  if (out.code !== 0) return { kind: 'failed', code: out.code, stderr, cli: out.cli }
  return null
}

async function ask(provider: Provider, model: string, prompt: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<AiOutput> {
  const cli = cliOf(provider)
  if (!cli) return { code: 'missing', stdout: '', stderr: '', cli: provider }

  const signed = await loginOf(provider, cli)
  if (signed.login !== 'ready') return { code: 'logged-out', stdout: '', stderr: signed.login === 'api-key' ? 'signed in with an API key, not a subscription' : signed.detail, cli: provider }

  return { ...(await cli.exec(ARGS[provider](model, cwd), prompt, { cwd, timeoutMs, signal })), cli: provider }
}

export function aiRun(settingsDir: string): AiRun {
  return async (prompt, cwd, timeoutMs = TIMEOUT_MS, signal) => {
    const { connected, provider, models } = readSettings(path.join(settingsDir, 'settings.json')).ai
    if (!connected) return { code: 'not-connected', stdout: '', stderr: '', cli: provider }

    const out = await ask(provider, models[provider], prompt, cwd, timeoutMs, signal)
    if (signal?.aborted) return out

    const failed = failureOf(out)
    lastFailure = failed ? { reason: failed, at: Date.now() } : null
    return out
  }
}
