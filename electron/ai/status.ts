import os from 'node:os'
import { type CliStatus, DEFAULT_MODELS, type Login, type Provider } from '../../shared/settings'
import { type Cli, cliOf } from './cli'

const STATUS_MS = 15_000
const CLAUDE_MODELS = ['haiku', 'sonnet', 'opus']
const SUBSCRIPTIONS = ['claude.ai', 'oauth_token']

type Signed = { login: Login; detail: string }

const quick = (cli: Cli, args: string[]) => cli.exec(args, '', { cwd: os.homedir(), timeoutMs: STATUS_MS })

function objectOf(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function claudeLogin(cli: Cli): Promise<Signed> {
  const out = await quick(cli, ['auth', 'status', '--json'])
  const auth = objectOf(out.stdout.trim())
  if (!auth || typeof auth.loggedIn !== 'boolean') return { login: 'unreadable', detail: (out.stderr || out.stdout).trim() }
  if (!auth.loggedIn) return { login: 'logged-out', detail: '' }

  const method = String(auth.authMethod)
  if (!SUBSCRIPTIONS.includes(method)) return { login: 'api-key', detail: method }
  return { login: 'ready', detail: typeof auth.subscriptionType === 'string' ? `${auth.subscriptionType} plan` : method }
}

async function codexLogin(cli: Cli): Promise<Signed> {
  const out = await quick(cli, ['login', 'status'])
  const said = `${out.stdout}\n${out.stderr}`.trim()
  if (out.code !== 0) return { login: out.code === 'timeout' ? 'unreadable' : 'logged-out', detail: said }
  return said.includes('ChatGPT') ? { login: 'ready', detail: 'ChatGPT plan' } : { login: 'api-key', detail: '' }
}

export async function loginOf(provider: Provider, cli: Cli): Promise<Signed> {
  return provider === 'claude' ? claudeLogin(cli) : codexLogin(cli)
}

async function modelsOf(provider: Provider, cli: Cli): Promise<string[]> {
  if (provider === 'claude') return CLAUDE_MODELS

  const catalog = objectOf((await quick(cli, ['debug', 'models'])).stdout)
  const listed = Array.isArray(catalog?.models) ? (catalog.models as Array<{ slug?: unknown; visibility?: unknown }>) : []
  const slugs = listed.filter((model) => model.visibility === 'list' && typeof model.slug === 'string').map((model) => String(model.slug))
  return slugs.length ? slugs : [DEFAULT_MODELS.codex]
}

export async function statusOf(provider: Provider): Promise<CliStatus> {
  const cli = cliOf(provider)
  if (!cli) return { provider, login: 'missing', detail: '', models: [] }

  const [signed, models] = await Promise.all([loginOf(provider, cli), modelsOf(provider, cli)])
  return { provider, ...signed, models }
}
