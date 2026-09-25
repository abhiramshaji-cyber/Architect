import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  allRepos,
  auth,
  clone,
  COMPARE_LANES,
  compare,
  compareAll,
  createPull,
  type GhOutput,
  type GhRun,
  runGh,
  ghEnv,
  branches,
  pullFor,
  pulls,
  rates,
  REPO_PAGE,
  token,
} from './github'

function fake(handler: (args: string[]) => Partial<GhOutput>, online = true) {
  const calls: string[][] = []
  const cwds: (string | undefined)[] = []
  let reached = 0

  const run: GhRun = async (args, _timeoutMs, cwd) => {
    calls.push(args)
    cwds.push(cwd)
    return { code: 0, stdout: '', stderr: '', ...handler(args) }
  }

  return {
    gh: {
      run,
      reach: async () => {
        reached += 1
        return online
      },
    },
    calls,
    cwds,
    reaches: () => reached,
  }
}

function valueOf(args: string[], flag: string): string {
  return args[args.indexOf(flag) + 1] ?? ''
}

function hosts(entries: unknown[]): string {
  return JSON.stringify({ hosts: { 'github.com': entries } })
}

const ACTIVE = {
  state: 'success',
  active: true,
  host: 'github.com',
  login: 'octocat',
  tokenSource: 'keyring',
  scopes: 'gist, read:org, repo, workflow',
  gitProtocol: 'https',
}

describe('ghEnv', () => {
  it('scrubs every inherited github token variable', () => {
    const env = ghEnv({
      GH_TOKEN: 'a',
      GITHUB_TOKEN: 'b',
      GH_ENTERPRISE_TOKEN: 'c',
      GITHUB_ENTERPRISE_TOKEN: 'd',
      PATH: '/usr/bin',
    })

    expect(env).toEqual({ PATH: '/usr/bin' })
  })

  it('does not mutate the environment it was given', () => {
    const source = { GH_TOKEN: 'a', PATH: '/usr/bin' }
    ghEnv(source)

    expect(source.GH_TOKEN).toBe('a')
  })
})

describe('auth', () => {
  it('reports a logged in account with its scopes', async () => {
    const out = await auth(fake(() => ({ stdout: hosts([ACTIVE]) })).gh)

    expect(out).toEqual({
      ok: true,
      value: { kind: 'logged-in', account: { host: 'github.com', login: 'octocat', scopes: ['gist', 'read:org', 'repo', 'workflow'] } },
    })
  })

  it('reports logged out when gh exits zero with no hosts', async () => {
    const out = await auth(fake(() => ({ code: 0, stdout: '{"hosts":{}}' })).gh)

    expect(out).toEqual({ ok: true, value: { kind: 'logged-out', host: 'github.com' } })
  })

  it('reports logged out when every entry is inactive', async () => {
    const out = await auth(fake(() => ({ stdout: hosts([{ ...ACTIVE, active: false }]) })).gh)

    expect(out).toEqual({ ok: true, value: { kind: 'logged-out', host: 'github.com' } })
  })

  it('reports not installed when gh cannot be spawned', async () => {
    const out = await auth(fake(() => ({ code: 'missing' })).gh)

    expect(out).toEqual({ ok: true, value: { kind: 'not-installed' } })
  })

  it('reports insufficient scopes when the active account cannot read repositories', async () => {
    const out = await auth(fake(() => ({ stdout: hosts([{ ...ACTIVE, scopes: 'gist, read:org' }]) })).gh)

    expect(out).toEqual({
      ok: true,
      value: {
        kind: 'insufficient-scopes',
        account: { host: 'github.com', login: 'octocat', scopes: ['gist', 'read:org'] },
        missing: ['repo'],
      },
    })
  })

  it('reports logged out for a failed entry while github is reachable', async () => {
    const broken = hosts([{ ...ACTIVE, state: 'error', error: 'non-200 OK status code: 401 Unauthorized', scopes: undefined }])
    const out = await auth(fake(() => ({ stdout: broken }), true).gh)

    expect(out).toEqual({ ok: true, value: { kind: 'logged-out', host: 'github.com' } })
  })

  it('reports unreachable rather than logged out when github cannot be reached', async () => {
    const offline = hosts([{ ...ACTIVE, state: 'error', error: 'Get "https://api.github.com/": dial tcp: connection refused' }])
    const out = await auth(fake(() => ({ stdout: offline }), false).gh)

    expect(out).toEqual({
      ok: true,
      value: { kind: 'unreachable', host: 'github.com', detail: 'Get "https://api.github.com/": dial tcp: connection refused' },
    })
  })

  it('fails rather than guessing when the status output is not json', async () => {
    const out = await auth(fake(() => ({ stdout: 'not json' })).gh)

    expect(out).toEqual({ ok: false, error: { kind: 'unreadable', args: ['auth', 'status', '--json', 'hosts'] } })
  })

  it('reports logged out even though gh auth token still returns a keychain token', async () => {
    const machine = fake((args) => (args[1] === 'token' ? { stdout: 'gho_keychain\n' } : { stdout: '{"hosts":{}}' }))

    expect(await auth(machine.gh)).toEqual({ ok: true, value: { kind: 'logged-out', host: 'github.com' } })
    expect(await token(machine.gh)).toEqual({ ok: true, value: 'gho_keychain' })
  })
})

describe('token', () => {
  it('reads the token gh owns without copying it anywhere', async () => {
    const machine = fake(() => ({ stdout: 'gho_secret\n' }))
    const out = await token(machine.gh)

    expect(out).toEqual({ ok: true, value: 'gho_secret' })
    expect(machine.calls).toEqual([['auth', 'token', '--hostname', 'github.com']])
  })

  it('reports not installed when gh is absent', async () => {
    expect(await token(fake(() => ({ code: 'missing' })).gh)).toEqual({ ok: false, error: { kind: 'not-installed' } })
  })

  it('reports a failure when gh prints no token', async () => {
    const out = await token(fake(() => ({ code: 1, stderr: 'no token' })).gh)

    expect(out).toEqual({ ok: false, error: { kind: 'failed', args: ['auth', 'token', '--hostname', 'github.com'], code: 1, stderr: 'no token' } })
  })
})

const REPO_ROW = {
  nameWithOwner: 'octocat/hello',
  name: 'hello',
  owner: { id: 'U_1', login: 'octocat' },
  description: 'a repo',
  isPrivate: true,
  isFork: false,
  isArchived: false,
  defaultBranchRef: { name: 'main' },
  pushedAt: '2026-09-22T20:05:15Z',
  url: 'https://github.com/octocat/hello',
  primaryLanguage: { name: 'TypeScript' },
}

function asked(args: string[]): { path: string; page: number; size: number } {
  const url = new URL(`https://api.github.com/${args[1]}`)

  return {
    path: url.pathname,
    page: Number(url.searchParams.get('page')),
    size: Number(url.searchParams.get('per_page')),
  }
}

function rows(names: string[]): string {
  return names.map((name) => JSON.stringify({ nameWithOwner: name })).join('\n')
}

function account(pages: Record<string, string[][]>, over?: (args: string[]) => Partial<GhOutput> | undefined) {
  return fake((args) => {
    const wanted = over?.(args)
    if (wanted) return wanted

    const { path, page } = asked(args)

    return { stdout: rows(pages[path]?.[page - 1] ?? []) }
  })
}

const MINE = '/user/repos'
const ORGS = ['/orgs/iolotech/repos', '/orgs/botpress/repos', '/orgs/webarts/repos', '/orgs/The-Blue-Space-Australia/repos']

function many(count: number, prefix = 'me/repo'): string[] {
  return Array.from({ length: count }, (_, at) => `${prefix}-${String(at).padStart(4, '0')}`)
}

describe('allRepos', () => {
  it('flattens the row fields the picker renders', async () => {
    const out = await allRepos(REPO_PAGE, fake((args) => ({ stdout: asked(args).path === MINE ? JSON.stringify(REPO_ROW) : '' })).gh)

    expect(out).toEqual({
      ok: true,
      value: [
        {
          nameWithOwner: 'octocat/hello',
          name: 'hello',
          owner: 'octocat',
          description: 'a repo',
          isPrivate: true,
          isFork: false,
          isArchived: false,
          defaultBranch: 'main',
          pushedAt: '2026-09-22T20:05:15Z',
          url: 'https://github.com/octocat/hello',
          language: 'TypeScript',
        },
      ],
    })
  })

  it('asks the account endpoint for one hundred at a time rather than a capped single call', async () => {
    const listing = account({})
    await allRepos(REPO_PAGE, listing.gh)

    expect(listing.calls[0]?.[0]).toBe('api')
    expect(asked(listing.calls[0] as string[])).toEqual({ path: MINE, page: 1, size: REPO_PAGE })
    expect(listing.calls.every((args) => !args.includes('--limit'))).toBe(true)
  })

  it('treats a limit it cannot page as a request for the first page', async () => {
    const listing = account({ [MINE]: [['me/one']] })
    for (const limit of [0, -5, Number.NaN, 1]) {
      await allRepos(limit, listing.gh)
      expect(asked(listing.calls.at(-1) as string[]).size).toBe(REPO_PAGE)
    }

    expect(listing.calls.filter((args) => asked(args).path === MINE)).toHaveLength(4)
  })

  it('leaves a source that never runs out rather than walking it forever', async () => {
    const endless = account({}, (args) => (asked(args).path === MINE ? { stdout: rows(many(REPO_PAGE)) } : undefined))
    await allRepos(REPO_PAGE, endless.gh)
    const out = await allRepos(1_000_000, endless.gh)

    expect(out).toMatchObject({ ok: true })
    expect(endless.calls.filter((args) => asked(args).path === MINE)).toHaveLength(100)
    expect(endless.calls.map((args) => asked(args).path)).toContain(ORGS[3])
  })

  it('returns the empty account as an empty listing rather than a failure', async () => {
    const out = await allRepos(REPO_PAGE, account({}).gh)

    expect(out).toEqual({ ok: true, value: [] })
  })

  it('stops at the first full page and reaches the rest only when asked for more', async () => {
    const all = many(250)
    const listing = account({ [MINE]: [all.slice(0, 100), all.slice(100, 200), all.slice(200)] })

    const first = await allRepos(REPO_PAGE, listing.gh)
    expect(first.ok && first.value.length).toBe(100)
    expect(listing.calls.length).toBe(1)

    const second = await allRepos(200, listing.gh)
    expect(second.ok && second.value.length).toBe(200)
    expect(listing.calls.length).toBe(2)

    const third = await allRepos(300, listing.gh)
    expect(third.ok && third.value).toEqual(all.map((name) => expect.objectContaining({ nameWithOwner: name })))
  })

  it('never reads a page twice while walking a multi page account', async () => {
    const all = many(250)
    const listing = account({ [MINE]: [all.slice(0, 100), all.slice(100, 200), all.slice(200)] })

    await allRepos(REPO_PAGE, listing.gh)
    await allRepos(200, listing.gh)
    await allRepos(300, listing.gh)

    const walked = listing.calls.map((args) => `${asked(args).path}#${asked(args).page}`)

    expect(walked.length).toBe(new Set(walked).size)
    expect(walked.filter((step) => step.startsWith(MINE))).toEqual([`${MINE}#1`, `${MINE}#2`, `${MINE}#3`])
  })

  it('spends nothing once the account is exhausted', async () => {
    const listing = account({ [MINE]: [['me/one']] })
    await allRepos(REPO_PAGE, listing.gh)
    const spent = listing.calls.length

    const again = await allRepos(1000, listing.gh)

    expect(again.ok && again.value.map((repo) => repo.nameWithOwner)).toEqual(['me/one'])
    expect(listing.calls.length).toBe(spent)
  })

  it('restarts the listing when the first page is asked for again', async () => {
    const listing = account({ [MINE]: [['me/one']] })
    await allRepos(REPO_PAGE, listing.gh)
    const spent = listing.calls.length

    const out = await allRepos(REPO_PAGE, listing.gh)

    expect(out.ok && out.value.map((repo) => repo.nameWithOwner)).toEqual(['me/one'])
    expect(listing.calls.length).toBe(spent * 2)
  })

  it('walks every organisation the account never joined but works in', async () => {
    const listing = account(Object.fromEntries([MINE, ...ORGS].map((path) => [path, [[`${path.split('/')[2] ?? 'me'}/thing`]]])))
    const out = await allRepos(REPO_PAGE, listing.gh)

    expect(listing.calls.map((args) => asked(args).path)).toEqual([MINE, ...ORGS])
    expect(out.ok && out.value.length).toBe(5)
  })

  it('keeps one copy of a repo the account sees twice', async () => {
    const listing = account({ [MINE]: [['shared/thing']], [ORGS[0] as string]: [['shared/thing', 'iolotech/other']] })
    const out = await allRepos(REPO_PAGE, listing.gh)

    expect(out.ok && out.value.map((repo) => repo.nameWithOwner)).toEqual(['shared/thing', 'iolotech/other'])
  })

  it('keeps the listing when one organisation refuses', async () => {
    const listing = account({ [MINE]: [['me/own']] }, (args) =>
      asked(args).path === ORGS[0] ? { code: 1, stdout: '{"message":"Not Found","status":"404"}' } : undefined,
    )
    const out = await allRepos(REPO_PAGE, listing.gh)

    expect(out).toMatchObject({ ok: true })
    expect(out.ok && out.value.map((repo) => repo.nameWithOwner)).toEqual(['me/own'])
    expect(listing.calls.map((args) => asked(args).path)).toEqual([MINE, ...ORGS])
  })

  it('stops the walk when an organisation fails for a reason the whole account shares', async () => {
    const listing = account({ [MINE]: [['me/own']] }, (args) => (asked(args).path === ORGS[0] ? { code: 4 } : undefined))
    const out = await allRepos(REPO_PAGE, listing.gh)

    expect(out).toEqual({ ok: false, error: { kind: 'auth-required' } })
    expect(listing.calls.map((args) => asked(args).path)).toEqual([MINE, ORGS[0]])
  })

  it('reports authentication required on exit code four', async () => {
    const out = await allRepos(REPO_PAGE, fake(() => ({ code: 4 })).gh)

    expect(out).toEqual({ ok: false, error: { kind: 'auth-required' } })
  })

  it('reports unreachable rather than a generic failure when the network is down', async () => {
    const machine = fake(() => ({ code: 1, stderr: 'connection refused' }), false)
    const out = await allRepos(REPO_PAGE, machine.gh)

    expect(out).toEqual({ ok: false, error: { kind: 'unreachable', detail: 'connection refused' } })
  })

  it('reports a spent budget as rate limiting rather than an empty listing', async () => {
    const spent = {
      resources: {
        core: { limit: 5000, remaining: 0, reset: 100 },
        graphql: { limit: 5000, remaining: 5000, reset: 200 },
        search: { limit: 30, remaining: 30, reset: 300 },
      },
    }
    const machine = fake((args) => (args[1] === 'rate_limit' ? { stdout: JSON.stringify(spent) } : { code: 1, stderr: 'HTTP 403' }))
    const out = await allRepos(REPO_PAGE, machine.gh)

    expect(out).toEqual({ ok: false, error: { kind: 'rate-limited', resource: 'core', resetAt: 100_000 } })
  })

  it('reports a timed out page rather than a failure', async () => {
    const out = await allRepos(REPO_PAGE, fake(() => ({ code: 'timeout' })).gh)

    expect(out).toMatchObject({ ok: false, error: { kind: 'timed-out' } })
  })

  it('fails rather than dropping a row it cannot read, and reads that page again next time', async () => {
    const listing = account({ [MINE]: [['me/own']] }, (args) =>
      asked(args).path === MINE && listing.calls.length === 1 ? { stdout: '{"nope":true}' } : undefined,
    )

    expect(await allRepos(REPO_PAGE, listing.gh)).toMatchObject({ ok: false, error: { kind: 'unreadable' } })

    const out = await allRepos(200, listing.gh)

    expect(out.ok && out.value.map((repo) => repo.nameWithOwner)).toEqual(['me/own'])
  })

  it('serialises overlapping walks so no page is skipped', async () => {
    const all = many(300)
    const listing = account({ [MINE]: [all.slice(0, 100), all.slice(100, 200), all.slice(200, 300), []] })

    await allRepos(REPO_PAGE, listing.gh)
    const [left, right] = await Promise.all([allRepos(200, listing.gh), allRepos(300, listing.gh)])

    expect(left).toMatchObject({ ok: true })
    expect(right.ok && right.value.length).toBe(300)
    const walked = listing.calls.map((args) => `${asked(args).path}#${asked(args).page}`)
    expect(walked.length).toBe(new Set(walked).size)
  })
})

describe('branches', () => {
  it('reads every page as one stream of rows', async () => {
    const lines = [
      '{"name":"main","commit":"aaa","protected":true}',
      '{"name":"next","commit":"bbb","protected":false}',
      '{"name":"old","commit":"ccc","protected":false}',
      '',
    ].join('\n')
    const machine = fake(() => ({ stdout: lines }))
    const out = await branches('cli', 'cli', machine.gh)

    expect(out).toEqual({
      ok: true,
      value: [
        { name: 'main', commit: 'aaa', protected: true },
        { name: 'next', commit: 'bbb', protected: false },
        { name: 'old', commit: 'ccc', protected: false },
      ],
    })
    expect(machine.calls[0]).toEqual([
      'api',
      'repos/cli/cli/branches?per_page=100',
      '--paginate',
      '--jq',
      '.[] | {name: .name, commit: .commit.sha, protected: .protected}',
    ])
  })

  it('refuses an owner or repo that would rewrite the request path', async () => {
    const machine = fake(() => ({ stdout: '' }))

    expect(await branches('cli/../../user', 'cli', machine.gh)).toEqual({ ok: false, error: { kind: 'bad-argument', value: 'cli/../../user' } })
    expect(await branches('cli', '', machine.gh)).toEqual({ ok: false, error: { kind: 'bad-argument', value: '' } })
    expect(machine.calls).toEqual([])
  })

  it('reports a missing repository from the error body rather than the message', async () => {
    const body = '{"message":"Not Found","documentation_url":"https://docs.github.com/rest","status":"404"}'
    const machine = fake(() => ({ code: 1, stdout: body, stderr: 'gh: Not Found (HTTP 404)' }))
    const out = await branches('cli', 'gone', machine.gh)

    expect(out).toEqual({ ok: false, error: { kind: 'not-found' } })
    expect(machine.reaches()).toBe(0)
  })

  it('reports authentication required from a 401 body', async () => {
    const body = '{"message":"Bad credentials","status":"401"}'
    const out = await branches('cli', 'cli', fake(() => ({ code: 1, stdout: body })).gh)

    expect(out).toEqual({ ok: false, error: { kind: 'auth-required' } })
  })

  it('fails when a row cannot be read', async () => {
    const out = await branches('cli', 'cli', fake(() => ({ stdout: '{"name":"main"}\nnot json\n' })).gh)

    expect(out).toMatchObject({ ok: false, error: { kind: 'unreadable' } })
  })
})

describe('rates', () => {
  it('reports every budget in milliseconds', async () => {
    const body = {
      resources: {
        core: { limit: 5000, remaining: 4960, reset: 1790108702 },
        graphql: { limit: 5000, remaining: 5000, reset: 1790111458 },
        search: { limit: 30, remaining: 30, reset: 1790108000 },
      },
    }
    const out = await rates(fake(() => ({ stdout: JSON.stringify(body) })).gh)

    expect(out).toEqual({
      ok: true,
      value: {
        core: { limit: 5000, remaining: 4960, resetAt: 1790108702_000 },
        graphql: { limit: 5000, remaining: 5000, resetAt: 1790111458_000 },
        search: { limit: 30, remaining: 30, resetAt: 1790108000_000 },
      },
    })
  })

  it('fails when a resource is missing', async () => {
    const out = await rates(fake(() => ({ stdout: '{"resources":{"core":{"limit":1,"remaining":1,"reset":2}}}' })).gh)

    expect(out).toMatchObject({ ok: false, error: { kind: 'unreadable' } })
  })
})

describe('pulls', () => {
  it('reads the number, title, head branch and url of each open pull request', async () => {
    const url = 'https://github.com/cli/cli/pull/7'
    const rows = JSON.stringify([{ number: 7, title: 'a fix', headRefName: 'fix/thing', url }])
    const out = await pulls('cli', 'cli', fake(() => ({ stdout: rows })).gh)

    expect(out).toEqual({ ok: true, value: [{ number: 7, title: 'a fix', head: 'fix/thing', url }] })
  })

  it('fails rather than dropping a row missing its head branch', async () => {
    const out = await pulls('cli', 'cli', fake(() => ({ stdout: JSON.stringify([{ number: 7 }]) })).gh)

    expect(out).toMatchObject({ ok: false, error: { kind: 'unreadable' } })
  })

  it('refuses an owner that is not a path segment', async () => {
    expect(await pulls('../etc', 'cli', fake(() => ({})).gh)).toEqual({
      ok: false,
      error: { kind: 'bad-argument', value: '../etc' },
    })
  })
})

describe('clone', () => {
  it('hands gh the repository and the target directory', async () => {
    const machine = fake(() => ({ code: 0 }))
    const out = await clone('octocat/hello', '/repos/hello', machine.gh)

    expect(out).toEqual({ ok: true, value: { path: '/repos/hello' } })
    expect(machine.calls[0]).toEqual(['repo', 'clone', 'octocat/hello', '/repos/hello'])
  })

  it('allows longer than a listing before giving up, because a clone is not a read', async () => {
    const waits: (number | undefined)[] = []
    const gh = { run: async (_args: string[], timeoutMs?: number) => { waits.push(timeoutMs); return { code: 0, stdout: '', stderr: '' } satisfies GhOutput }, reach: async () => true }
    await clone('octocat/hello', '/repos/hello', gh)

    expect(waits[0]).toBeGreaterThan(60_000)
  })

  it('refuses a target that git would read as a flag and a name that is not owner and repo', async () => {
    expect(await clone('octocat/hello', '--upload-pack=x', fake(() => ({})).gh)).toEqual({
      ok: false,
      error: { kind: 'bad-argument', value: '--upload-pack=x' },
    })
    expect(await clone('octocat/hello/extra', '/repos/hello', fake(() => ({})).gh)).toEqual({
      ok: false,
      error: { kind: 'bad-argument', value: 'octocat/hello/extra' },
    })
  })

  it('reports a repository the token cannot reach rather than a raw exit code', async () => {
    const body = JSON.stringify({ status: '404' })
    const out = await clone('octocat/hello', '/repos/hello', fake(() => ({ code: 1, stdout: body })).gh)

    expect(out).toEqual({ ok: false, error: { kind: 'not-found' } })
  })
})

function distance(ahead: number, behind: number): string {
  return JSON.stringify({ ahead, behind })
}

function headOf(args: string[]): string {
  return (args[1] ?? '').split('...')[1] ?? ''
}

describe('compare', () => {
  it('asks the compare endpoint for the two counts of one branch against the base', async () => {
    const machine = fake(() => ({ stdout: distance(3, 1) }))
    const out = await compare('octocat', 'hello', 'main', 'feature/login', machine.gh)

    expect(out).toEqual({ ok: true, value: { ahead: 3, behind: 1 } })
    expect(machine.calls[0]?.[1]).toBe('repos/octocat/hello/compare/main...feature/login')
  })

  it('refuses a ref that would reach outside the compare it was asked for', async () => {
    for (const bad of ['../../user', 'main...other', '-x', 'feet/', '', 'a b', 'has#hash', 'has%25']) {
      expect(await compare('octocat', 'hello', 'main', bad, fake(() => ({})).gh)).toEqual({
        ok: false,
        error: { kind: 'bad-argument', value: bad },
      })
    }
  })

  it('refuses an owner that is not a path segment before spawning gh', async () => {
    const machine = fake(() => ({}))
    expect(await compare('octocat/../evil', 'hello', 'main', 'topic', machine.gh)).toEqual({
      ok: false,
      error: { kind: 'bad-argument', value: 'octocat/../evil' },
    })
    expect(machine.calls).toEqual([])
  })

  it('reports not found for two branches with no common ancestor', async () => {
    const body = JSON.stringify({ status: '404', message: 'No common ancestor between main and orphan.' })
    const out = await compare('octocat', 'hello', 'main', 'orphan', fake(() => ({ code: 1, stdout: body })).gh)

    expect(out).toEqual({ ok: false, error: { kind: 'not-found' } })
  })

  it('reports authentication required when the account cannot read the repository', async () => {
    const out = await compare('octocat', 'hello', 'main', 'topic', fake(() => ({ code: 4, stderr: 'gh: auth' })).gh)

    expect(out).toEqual({ ok: false, error: { kind: 'auth-required' } })
  })

  it('fails rather than guessing when a count is missing', async () => {
    const out = await compare('octocat', 'hello', 'main', 'topic', fake(() => ({ stdout: '{"ahead":2}' })).gh)

    expect(out).toMatchObject({ ok: false, error: { kind: 'unreadable' } })
  })
})

describe('compareAll', () => {
  it('reports each branch as it resolves and never compares the base against itself', async () => {
    const machine = fake((args) => ({ stdout: distance(headOf(args).length, 0) }))
    const seen: string[] = []

    await compareAll('octocat', 'hello', 'main', ['main', 'ab', 'abc', 'ab'], (head) => seen.push(head), undefined, machine.gh)

    expect(seen).toEqual(['ab', 'abc'])
    expect(machine.calls).toHaveLength(2)
  })

  it('keeps at most one lane per named slot in flight over a large branch list', async () => {
    const heads = Array.from({ length: 200 }, (_value, at) => `topic-${at}`)
    let live = 0
    let peak = 0

    const gh = {
      reach: async () => true,
      run: async (): Promise<GhOutput> => {
        live += 1
        peak = Math.max(peak, live)
        await Promise.resolve()
        live -= 1
        return { code: 0, stdout: distance(1, 0), stderr: '' }
      },
    }

    const seen: string[] = []
    await compareAll('octocat', 'hello', 'main', heads, (head) => seen.push(head), undefined, gh)

    expect(seen).toHaveLength(200)
    expect(peak).toBeLessThanOrEqual(COMPARE_LANES)
  })

  it('stops dispatching and reports nothing more once the run is aborted', async () => {
    const heads = Array.from({ length: 50 }, (_value, at) => `topic-${at}`)
    const run = new AbortController()
    const machine = fake(() => ({ stdout: distance(1, 0) }))
    const seen: string[] = []

    await compareAll(
      'octocat',
      'hello',
      'main',
      heads,
      (head) => {
        seen.push(head)
        run.abort()
      },
      run.signal,
      machine.gh,
    )

    expect(seen).toEqual(['topic-0'])
    expect(machine.calls.length).toBeLessThanOrEqual(COMPARE_LANES)
  })

  it('halts the whole run when a compare comes back rate limited instead of spending the rest', async () => {
    const spent = {
      resources: {
        core: { limit: 5000, remaining: 0, reset: 400 },
        graphql: { limit: 5000, remaining: 5000, reset: 200 },
        search: { limit: 30, remaining: 30, reset: 300 },
      },
    }
    const heads = Array.from({ length: 80 }, (_value, at) => `topic-${at}`)
    const machine = fake((args) =>
      args[1] === 'rate_limit' ? { stdout: JSON.stringify(spent) } : { code: 1, stdout: '{"status":"403"}' },
    )

    const seen: string[] = []
    await compareAll('octocat', 'hello', 'main', heads, (_head, result) => {
      if (!result.ok) seen.push(result.error.kind)
    }, undefined, machine.gh)

    expect(seen[0]).toBe('rate-limited')
    expect(seen.length).toBeLessThanOrEqual(COMPARE_LANES)
  })

  it('leaves one failing branch without counts and keeps comparing the others', async () => {
    const machine = fake((args) =>
      headOf(args) === 'broken' ? { code: 1, stdout: '{"status":"404"}' } : { stdout: distance(2, 0) },
    )

    const got = new Map<string, boolean>()
    await compareAll('octocat', 'hello', 'main', ['broken', 'fine', 'other'], (head, result) => {
      got.set(head, result.ok)
    }, undefined, machine.gh)

    expect(Object.fromEntries(got)).toEqual({ broken: false, fine: true, other: true })
  })

  it('spawns nothing when every branch given is the base', async () => {
    const machine = fake(() => ({}))
    await compareAll('octocat', 'hello', 'main', ['main'], () => {}, undefined, machine.gh)

    expect(machine.calls).toEqual([])
  })
})

describe('pullFor', () => {
  it('asks gh in the worktree for the open pull request on one branch', async () => {
    const url = 'https://github.com/cli/cli/pull/9'
    const rows = JSON.stringify([{ number: 9, title: 'a fix', headRefName: 'fix/thing', url }])
    const listing = fake(() => ({ stdout: rows }))

    const out = await pullFor('/work/tree', 'fix/thing', listing.gh)

    expect(out).toEqual({ ok: true, value: { number: 9, title: 'a fix', head: 'fix/thing', url } })
    expect(listing.cwds).toEqual(['/work/tree'])
    expect(valueOf(listing.calls[0] ?? [], '--head')).toBe('fix/thing')
    expect(valueOf(listing.calls[0] ?? [], '--state')).toBe('open')
  })

  it('reports no pull request rather than failing when the branch has none', async () => {
    const out = await pullFor('/work/tree', 'fix/thing', fake(() => ({ stdout: '[]' })).gh)

    expect(out).toEqual({ ok: true, value: null })
  })

  it('refuses a head that is not a usable ref', async () => {
    const listing = fake(() => ({ stdout: '[]' }))
    const out = await pullFor('/work/tree', 'fix/..thing', listing.gh)

    expect(out).toEqual({ ok: false, error: { kind: 'bad-argument', value: 'fix/..thing' } })
    expect(listing.calls).toEqual([])
  })

  it('reports gh being logged out through the exit 4 mapping', async () => {
    const out = await pullFor('/work/tree', 'fix/thing', fake(() => ({ code: 4 })).gh)

    expect(out).toEqual({ ok: false, error: { kind: 'auth-required' } })
  })
})

describe('createPull', () => {
  it('passes the base, the head and the title in argv and the body through a file', async () => {
    const body = '-- a leading dash\n\n`backticks` and "quotes"\n\nlast line'
    let sent = ''
    const creating = fake((args) => {
      sent = fs.readFileSync(valueOf(args, '--body-file'), 'utf8')
      return { stdout: 'https://github.com/cli/cli/pull/12\n' }
    })

    const out = await createPull('/work/tree', 'main', 'fix/thing', 'fix: the thing', body, creating.gh)

    expect(out).toEqual({
      ok: true,
      value: { number: 12, title: 'fix: the thing', head: 'fix/thing', url: 'https://github.com/cli/cli/pull/12' },
    })
    expect(sent).toBe(body)

    const args = creating.calls[0] ?? []
    expect(valueOf(args, '--base')).toBe('main')
    expect(valueOf(args, '--head')).toBe('fix/thing')
    expect(valueOf(args, '--title')).toBe('fix: the thing')
    expect(args).not.toContain('--body')
    expect(creating.cwds).toEqual(['/work/tree'])
  })

  it('removes the body file once gh has read it', async () => {
    let file = ''
    const creating = fake((args) => {
      file = valueOf(args, '--body-file')
      return { stdout: 'https://github.com/cli/cli/pull/12\n' }
    })

    await createPull('/work/tree', 'main', 'fix/thing', 'title', 'body', creating.gh)

    expect(fs.existsSync(file)).toBe(false)
  })

  it('refuses an empty title without running gh', async () => {
    const creating = fake(() => ({ stdout: '' }))
    const out = await createPull('/work/tree', 'main', 'fix/thing', '   ', 'body', creating.gh)

    expect(out).toEqual({ ok: false, error: { kind: 'bad-argument', value: '   ' } })
    expect(creating.calls).toEqual([])
  })

  it('refuses a base that is not a usable ref without running gh', async () => {
    const creating = fake(() => ({ stdout: '' }))
    const out = await createPull('/work/tree', 'main..x', 'fix/thing', 'title', 'body', creating.gh)

    expect(out).toEqual({ ok: false, error: { kind: 'bad-argument', value: 'main..x' } })
    expect(creating.calls).toEqual([])
  })

  it('refuses a title or body carrying a NUL byte without running gh', async () => {
    const creating = fake(() => ({ stdout: '' }))

    expect(await createPull('/work/tree', 'main', 'fix/thing', 'a\0b', 'body', creating.gh)).toEqual({
      ok: false,
      error: { kind: 'bad-argument', value: 'a\0b' },
    })
    expect(await createPull('/work/tree', 'main', 'fix/thing', 'title', 'a\0b', creating.gh)).toEqual({
      ok: false,
      error: { kind: 'bad-argument', value: 'a\0b' },
    })
    expect(creating.calls).toEqual([])
  })

  it('reports gh being logged out through the exit 4 mapping', async () => {
    const out = await createPull('/work/tree', 'main', 'fix/thing', 'title', 'body', fake(() => ({ code: 4 })).gh)

    expect(out).toEqual({ ok: false, error: { kind: 'auth-required' } })
  })

  it('reports an answer with no pull request url as unreadable', async () => {
    const out = await createPull('/work/tree', 'main', 'fix/thing', 'title', 'body', fake(() => ({ stdout: 'done\n' })).gh)

    expect(out).toMatchObject({ ok: false, error: { kind: 'unreadable' } })
  })
})

describe('runGh', () => {
  const inherited = process.env.PATH

  afterEach(() => {
    process.env.PATH = inherited
  })

  function onPath(script: string | null, mode = 0o755): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-gh-'))
    if (script !== null) fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh\n${script}\n`, { mode })
    process.env.PATH = dir
    return dir
  }

  it('reports missing only when gh is not on the path', async () => {
    onPath(null)
    expect((await runGh(['--version'])).code).toBe('missing')
  })

  it('passes a clean exit through', async () => {
    onPath('echo gh version 2')
    expect(await runGh(['--version'])).toEqual({ code: 0, stdout: 'gh version 2\n', stderr: '' })
  })

  it('keeps the exit code and stderr of a failing gh', async () => {
    onPath('echo "not logged in" >&2; exit 4')
    expect(await runGh(['auth', 'status'])).toEqual({ code: 4, stdout: '', stderr: 'not logged in\n' })
  })

  it('reports a hung gh as a timeout', async () => {
    onPath('exec /bin/sleep 5')
    expect((await runGh(['api', 'user'], 200)).code).toBe('timeout')
  })

  it('reports a gh that cannot run as a failure with its reason, not as missing', async () => {
    onPath('exit 0', 0o644)
    const out = await runGh(['--version'])

    expect(out.code).toBe(1)
    expect(out.stderr).toContain('EACCES')
  })
})
