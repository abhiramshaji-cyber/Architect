import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import type {
  GithubAuth,
  GithubBranch,
  GithubBudget,
  GithubCompare,
  GithubFailure,
  GithubPull,
  GithubRates,
  GithubRepo,
  GithubResult,
} from '../../shared/types'

const HOST = 'github.com'
const REQUIRED_SCOPES = ['repo']
const TOKEN_VARS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']
const TIMEOUT_MS = 20_000
const CLONE_TIMEOUT_MS = 30 * 60 * 1000
const MAX_OUTPUT = 16 * 1024 * 1024
const EXTRA_ORGS = ['iolotech', 'botpress', 'webarts', 'The-Blue-Space-Australia']

export type GhOutput = { code: number | 'missing' | 'timeout'; stdout: string; stderr: string }

export type GhRun = (args: string[], timeoutMs?: number, cwd?: string) => Promise<GhOutput>

export type Gh = { run: GhRun; reach: () => Promise<boolean> }

export function ghEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed = { ...env }
  for (const name of TOKEN_VARS) delete scrubbed[name]
  return scrubbed
}

export const runGh: GhRun = (args, timeoutMs = TIMEOUT_MS, cwd) =>
  new Promise((resolve) => {
    const options = { cwd, env: ghEnv(process.env), maxBuffer: MAX_OUTPUT, timeout: timeoutMs, windowsHide: true }

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

const SEGMENT = /^[A-Za-z0-9._-]+$/

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

const BRANCH_QUERY = '.[] | {name: .name, commit: .commit.sha, protected: .protected}'

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

const UNUSABLE_REF = /[\0-\x20~^:?*#%[\\\]]|@\{|\.\.|^[-./]|[./]$|\/\/|\.lock(\/|$)/

function ref(value: string): boolean {
  return value !== '' && !UNUSABLE_REF.test(value)
}

const COMPARE_QUERY = '{ahead: .ahead_by, behind: .behind_by}'

export async function compare(
  owner: string,
  repo: string,
  base: string,
  head: string,
  gh: Gh = GH,
): Promise<GithubResult<GithubCompare>> {
  for (const value of [owner, repo]) {
    if (!SEGMENT.test(value)) return { ok: false, error: { kind: 'bad-argument', value } }
  }
  for (const value of [base, head]) {
    if (!ref(value)) return { ok: false, error: { kind: 'bad-argument', value } }
  }

  const args = ['api', `repos/${owner}/${repo}/compare/${base}...${head}`, '--jq', COMPARE_QUERY]
  const out = await gh.run(args)
  if (out.code !== 0) return { ok: false, error: await classify(gh, args, out) }

  const row = record(parsed(out.stdout))
  const ahead = count(row?.ahead)
  const behind = count(row?.behind)
  if (ahead === null || behind === null) return { ok: false, error: { kind: 'unreadable', args } }

  return { ok: true, value: { ahead, behind } }
}

export const COMPARE_LANES = 6

const WHOLE_ACCOUNT: GithubFailure['kind'][] = ['not-installed', 'auth-required', 'rate-limited', 'unreachable']

export async function compareAll(
  owner: string,
  repo: string,
  base: string,
  heads: string[],
  emit: (head: string, result: GithubResult<GithubCompare>) => void,
  signal?: AbortSignal,
  gh: Gh = GH,
): Promise<void> {
  const queue = [...new Set(heads)].filter((head) => head !== base)
  let next = 0
  let halted = false

  const stopped = (): boolean => halted || signal?.aborted === true

  const lane = async (): Promise<void> => {
    while (next < queue.length && !stopped()) {
      const head = queue[next++] as string
      const result = await compare(owner, repo, base, head, gh)
      if (stopped()) return

      emit(head, result)
      if (!result.ok && WHOLE_ACCOUNT.includes(result.error.kind)) halted = true
    }
  }

  await Promise.all(Array.from({ length: Math.min(COMPARE_LANES, queue.length) }, lane))
}

export const REPO_PAGE = 100
const MAX_PAGES = 100

const ROW_FIELDS = [
  '.[] | {nameWithOwner: .full_name, name: .name, owner: {login: .owner.login},',
  'description: .description, isPrivate: .private, isFork: .fork, isArchived: .archived,',
  'defaultBranchRef: {name: .default_branch}, pushedAt: .pushed_at, url: .html_url,',
  'primaryLanguage: {name: .language}}',
].join(' ')

const SOURCES = [
  'user/repos?affiliation=owner,collaborator,organization_member',
  ...EXTRA_ORGS.map((org) => `orgs/${org}/repos?type=all`),
]

type Listing = { rows: GithubRepo[]; seen: Set<string>; source: number; page: number }

function fresh(): Listing {
  return { rows: [], seen: new Set(), source: 0, page: 1 }
}

let listing = fresh()

async function paged(limit: number, gh: Gh): Promise<GithubResult<GithubRepo[]>> {
  const wanted = Math.max(Math.trunc(limit) || REPO_PAGE, REPO_PAGE)
  if (wanted === REPO_PAGE) listing = fresh()

  const state = listing

  while (state.rows.length < wanted && state.source < SOURCES.length) {
    const path = `${SOURCES[state.source]}&sort=full_name&per_page=${REPO_PAGE}&page=${state.page}`
    const args = ['api', path, '--jq', ROW_FIELDS]
    const out = await gh.run(args)

    if (out.code !== 0) {
      const error = await classify(gh, args, out)
      if (state.source === 0 || WHOLE_ACCOUNT.includes(error.kind)) return { ok: false, error }

      state.source += 1
      state.page = 1
      continue
    }

    const lines = out.stdout.split('\n').filter((line) => line.trim() !== '')
    for (const line of lines) {
      const repo = repoOf(parsed(line))
      if (!repo) return { ok: false, error: { kind: 'unreadable', args } }
      if (state.seen.has(repo.nameWithOwner)) continue

      state.seen.add(repo.nameWithOwner)
      state.rows.push(repo)
    }

    if (lines.length < REPO_PAGE || state.page >= MAX_PAGES) {
      state.source += 1
      state.page = 1
    } else state.page += 1
  }

  return { ok: true, value: [...state.rows] }
}

let queued: Promise<unknown> = Promise.resolve()

export function allRepos(limit = REPO_PAGE, gh: Gh = GH): Promise<GithubResult<GithubRepo[]>> {
  const next = queued.then(() => paged(limit, gh))
  queued = next.catch(() => {})

  return next
}

const PULL_FIELDS = 'number,title,headRefName,url'

function pullOf(row: Record<string, unknown> | null): GithubPull | null {
  const number = count(row?.number)
  const head = text(row?.headRefName)
  const url = text(row?.url)
  if (number === null || head === '' || url === '') return null

  return { number, title: text(row?.title), head, url }
}

export async function pulls(owner: string, repo: string, gh: Gh = GH): Promise<GithubResult<GithubPull[]>> {
  for (const value of [owner, repo]) {
    if (!SEGMENT.test(value)) return { ok: false, error: { kind: 'bad-argument', value } }
  }

  const args = ['pr', 'list', '--repo', `${owner}/${repo}`, '--json', PULL_FIELDS, '--limit', '100']
  const out = await gh.run(args)
  if (out.code !== 0) return { ok: false, error: await classify(gh, args, out) }

  const listed = parsed(out.stdout)
  if (!Array.isArray(listed)) return { ok: false, error: { kind: 'unreadable', args } }

  const value: GithubPull[] = []
  for (const entry of listed) {
    const row = record(entry)
    const pull = pullOf(row)
    if (pull === null) return { ok: false, error: { kind: 'unreadable', args } }

    value.push(pull)
  }

  return { ok: true, value }
}

export async function pullFor(root: string, head: string, gh: Gh = GH): Promise<GithubResult<GithubPull | null>> {
  if (!ref(head)) return { ok: false, error: { kind: 'bad-argument', value: head } }

  const args = ['pr', 'list', '--head', head, '--state', 'open', '--json', PULL_FIELDS, '--limit', '1']
  const out = await gh.run(args, TIMEOUT_MS, root)
  if (out.code !== 0) return { ok: false, error: await classify(gh, args, out) }

  const listed = parsed(out.stdout)
  if (!Array.isArray(listed)) return { ok: false, error: { kind: 'unreadable', args } }
  if (listed.length === 0) return { ok: true, value: null }

  const pull = pullOf(record(listed[0]))
  return pull === null ? { ok: false, error: { kind: 'unreadable', args } } : { ok: true, value: pull }
}

export async function createPull(
  root: string,
  base: string,
  head: string,
  title: string,
  body: string,
  gh: Gh = GH,
): Promise<GithubResult<GithubPull>> {
  for (const value of [base, head]) {
    if (!ref(value)) return { ok: false, error: { kind: 'bad-argument', value } }
  }

  const subject = title.trim()
  if (subject === '' || subject.includes('\0')) return { ok: false, error: { kind: 'bad-argument', value: title } }
  if (body.includes('\0')) return { ok: false, error: { kind: 'bad-argument', value: body } }

  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'architect-pr-'))
  const file = path.join(folder, 'body.md')
  const args = ['pr', 'create', '--base', base, '--head', head, '--title', subject, '--body-file', file]

  try {
    await fs.writeFile(file, body, 'utf8')
    const out = await gh.run(args, TIMEOUT_MS, root)
    if (out.code !== 0) return { ok: false, error: await classify(gh, args, out) }

    const url = out.stdout.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('https://')).pop() ?? ''
    const number = Number.parseInt(url.slice(url.lastIndexOf('/') + 1), 10)
    if (url === '' || !Number.isFinite(number)) return { ok: false, error: { kind: 'unreadable', args } }

    return { ok: true, value: { number, title: subject, head, url } }
  } finally {
    await fs.rm(folder, { recursive: true, force: true })
  }
}

export async function clone(nameWithOwner: string, target: string, gh: Gh = GH): Promise<GithubResult<{ path: string }>> {
  const [owner = '', name = '', extra] = nameWithOwner.split('/')
  if (extra !== undefined || !SEGMENT.test(owner) || !SEGMENT.test(name)) {
    return { ok: false, error: { kind: 'bad-argument', value: nameWithOwner } }
  }
  if (target === '' || target.startsWith('-') || target.includes('\0')) {
    return { ok: false, error: { kind: 'bad-argument', value: target } }
  }

  const args = ['repo', 'clone', nameWithOwner, target]
  const out = await gh.run(args, CLONE_TIMEOUT_MS)
  if (out.code !== 0) return { ok: false, error: await classify(gh, args, out) }

  return { ok: true, value: { path: target } }
}
