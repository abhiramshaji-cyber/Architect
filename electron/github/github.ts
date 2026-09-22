import { execFile } from 'node:child_process'
import process from 'node:process'
import type {
  GithubAuth,
  GithubBranch,
  GithubBudget,
  GithubFailure,
  GithubRates,
  GithubRepo,
  GithubResult,
} from '../../shared/types'

const HOST = 'github.com'
const REQUIRED_SCOPES = ['repo']
const TOKEN_VARS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']
const TIMEOUT_MS = 20_000
const MAX_OUTPUT = 16 * 1024 * 1024
const MAX_REPOS = 1000

export type GhOutput = { code: number | 'missing' | 'timeout'; stdout: string; stderr: string }

export type GhRun = (args: string[]) => Promise<GhOutput>

export type Gh = { run: GhRun; reach: () => Promise<boolean> }

export function ghEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed = { ...env }
  for (const name of TOKEN_VARS) delete scrubbed[name]
  return scrubbed
}

export const runGh: GhRun = (args) =>
  new Promise((resolve) => {
    const options = { env: ghEnv(process.env), maxBuffer: MAX_OUTPUT, timeout: TIMEOUT_MS, windowsHide: true }

    execFile('gh', args, options, (error, stdout, stderr) => {
      if (!error) return resolve({ code: 0, stdout, stderr })

      const failure = error as { code?: unknown; killed?: boolean }
      if (failure.code === 'ENOENT') return resolve({ code: 'missing', stdout, stderr })
      if (failure.killed === true) return resolve({ code: 'timeout', stdout, stderr })

      resolve({ code: typeof failure.code === 'number' ? failure.code : 1, stdout, stderr })
    })
  })

async function reachable(): Promise<boolean> {
  try {
    await fetch(`https://api.${HOST}/`, { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS) })
    return true
  } catch {
    return false
  }
}

const GH: Gh = { run: runGh, reach: reachable }

function parsed(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function inner(value: unknown, key: string): string | null {
  const found = record(value)?.[key]
  return typeof found === 'string' && found !== '' ? found : null
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function direct(args: string[], out: GhOutput): GithubFailure {
  if (out.code === 'missing') return { kind: 'not-installed' }
  if (out.code === 'timeout') return { kind: 'timed-out', args }
  if (out.code === 4) return { kind: 'auth-required' }
  return { kind: 'failed', args, code: out.code, stderr: out.stderr.trim() }
}

function budget(value: unknown): GithubBudget | null {
  const row = record(value)
  const limit = count(row?.limit)
  const remaining = count(row?.remaining)
  const reset = count(row?.reset)
  if (limit === null || remaining === null || reset === null) return null

  return { limit, remaining, resetAt: reset * 1000 }
}

export async function rates(gh: Gh = GH): Promise<GithubResult<GithubRates>> {
  const args = ['api', 'rate_limit']
  const out = await gh.run(args)
  if (out.code !== 0) return { ok: false, error: direct(args, out) }

  const resources = record(record(parsed(out.stdout))?.resources)
  const core = budget(resources?.core)
  const graphql = budget(resources?.graphql)
  const search = budget(resources?.search)
  if (!core || !graphql || !search) return { ok: false, error: { kind: 'unreadable', args } }

  return { ok: true, value: { core, graphql, search } }
}

async function exhausted(gh: Gh): Promise<GithubFailure | null> {
  const budgets = await rates(gh)
  if (!budgets.ok) return null

  const spent = Object.entries(budgets.value).find(([, resource]) => resource.remaining === 0)
  return spent ? { kind: 'rate-limited', resource: spent[0], resetAt: spent[1].resetAt } : null
}

async function classify(gh: Gh, args: string[], out: GhOutput): Promise<GithubFailure> {
  const plain = direct(args, out)
  if (plain.kind !== 'failed') return plain

  const status = Number.parseInt(text(record(parsed(out.stdout))?.status), 10)
  if (status === 401) return { kind: 'auth-required' }
  if (status === 404) return { kind: 'not-found' }
  if (status === 403 || status === 429) return (await exhausted(gh)) ?? plain

  if (!(await gh.reach())) return { kind: 'unreachable', detail: out.stderr.trim() }

  return (await exhausted(gh)) ?? plain
}

function scopesOf(raw: string): string[] {
  return raw
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope !== '')
}

export async function auth(gh: Gh = GH): Promise<GithubResult<GithubAuth>> {
  const args = ['auth', 'status', '--json', 'hosts']
  const out = await gh.run(args)
  if (out.code === 'missing') return { ok: true, value: { kind: 'not-installed' } }

  const hosts = record(record(parsed(out.stdout))?.hosts)
  if (!hosts) return { ok: false, error: out.code === 0 ? { kind: 'unreadable', args } : direct(args, out) }

  const entries = hosts[HOST]
  const active = (Array.isArray(entries) ? entries : []).map(record).find((entry) => entry?.active === true)
  if (!active) return { ok: true, value: { kind: 'logged-out', host: HOST } }

  if (active.state !== 'success') {
    const online = await gh.reach()
    return online
      ? { ok: true, value: { kind: 'logged-out', host: HOST } }
      : { ok: true, value: { kind: 'unreachable', host: HOST, detail: text(active.error).trim() } }
  }

  const account = { host: HOST, login: text(active.login), scopes: scopesOf(text(active.scopes)) }
  const missing = REQUIRED_SCOPES.filter((scope) => !account.scopes.includes(scope))

  return { ok: true, value: missing.length > 0 ? { kind: 'insufficient-scopes', account, missing } : { kind: 'logged-in', account } }
}

export async function token(gh: Gh = GH): Promise<GithubResult<string>> {
  const args = ['auth', 'token', '--hostname', HOST]
  const out = await gh.run(args)
  if (out.code !== 0) return { ok: false, error: direct(args, out) }

  const value = out.stdout.trim()
  return value === '' ? { ok: false, error: { kind: 'unreadable', args } } : { ok: true, value }
}

const REPO_FIELDS =
  'nameWithOwner,name,owner,description,isPrivate,isFork,isArchived,defaultBranchRef,pushedAt,url,primaryLanguage'

function repoOf(value: unknown): GithubRepo | null {
  const row = record(value)
  const nameWithOwner = text(row?.nameWithOwner)
  if (!row || nameWithOwner === '') return null

  const [owner = ''] = nameWithOwner.split('/')

  return {
    nameWithOwner,
    name: text(row.name) || nameWithOwner.slice(owner.length + 1),
    owner: inner(row.owner, 'login') ?? owner,
    description: text(row.description),
    isPrivate: row.isPrivate === true,
    isFork: row.isFork === true,
    isArchived: row.isArchived === true,
    defaultBranch: inner(row.defaultBranchRef, 'name'),
    pushedAt: inner(row, 'pushedAt'),
    url: text(row.url),
    language: inner(row.primaryLanguage, 'name'),
  }
}

export async function repos(limit = 200, gh: Gh = GH): Promise<GithubResult<GithubRepo[]>> {
  const wanted = Math.min(Math.max(Math.trunc(limit) || 1, 1), MAX_REPOS)
  const args = ['repo', 'list', '--limit', String(wanted), '--json', REPO_FIELDS]

  const out = await gh.run(args)
  if (out.code !== 0) return { ok: false, error: await classify(gh, args, out) }

  const rows = parsed(out.stdout)
  if (!Array.isArray(rows)) return { ok: false, error: { kind: 'unreadable', args } }

  return { ok: true, value: rows.map(repoOf).filter((repo): repo is GithubRepo => repo !== null) }
}

const BRANCH_QUERY = '.[] | {name: .name, commit: .commit.sha, protected: .protected}'

const SEGMENT = /^[A-Za-z0-9._-]+$/

export async function branches(owner: string, repo: string, gh: Gh = GH): Promise<GithubResult<GithubBranch[]>> {
  for (const value of [owner, repo]) {
    if (!SEGMENT.test(value)) return { ok: false, error: { kind: 'bad-argument', value } }
  }

  const args = ['api', `repos/${owner}/${repo}/branches?per_page=100`, '--paginate', '--jq', BRANCH_QUERY]
  const out = await gh.run(args)
  if (out.code !== 0) return { ok: false, error: await classify(gh, args, out) }

  const value: GithubBranch[] = []
  for (const line of out.stdout.split('\n')) {
    if (line.trim() === '') continue

    const row = record(parsed(line))
    const name = text(row?.name)
    if (!row || name === '') return { ok: false, error: { kind: 'unreadable', args } }

    value.push({ name, commit: text(row.commit), protected: row.protected === true })
  }

  return { ok: true, value }
}
