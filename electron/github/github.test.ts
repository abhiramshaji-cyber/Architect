import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
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
  ghEnv,
  branches,
  pullFor,
  pulls,
  rates,
  repos,
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

function limits(calls: string[][]): (string | undefined)[] {
  return calls.map((args) => args[args.indexOf('--limit') + 1])
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

describe('repos', () => {
  it('flattens the narrow field set gh returns', async () => {
    const out = await repos(30, fake(() => ({ stdout: JSON.stringify([REPO_ROW]) })).gh)

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

  it('asks for more than the thirty gh lists by default', async () => {
    const machine = fake(() => ({ stdout: '[]' }))
    await repos(undefined, machine.gh)

    expect(machine.calls[0]).toContain('--limit')
    expect(limits(machine.calls)).toEqual(['200'])
  })

  it('clamps a limit that cannot be paged', async () => {
    const machine = fake(() => ({ stdout: '[]' }))
    await repos(0, machine.gh)
    await repos(50_000, machine.gh)
    await repos(Number.NaN, machine.gh)

    expect(limits(machine.calls)).toEqual(['1', '1000', '1'])
  })

  it('keeps a repo missing its optional fields and drops one without a full name', async () => {
    const rows = JSON.stringify([{ nameWithOwner: 'octocat/bare' }, { name: 'nameless' }])
    const out = await repos(10, fake(() => ({ stdout: rows })).gh)

    expect(out).toEqual({
      ok: true,
      value: [
        {
          nameWithOwner: 'octocat/bare',
          name: 'bare',
          owner: 'octocat',
          description: '',
          isPrivate: false,
          isFork: false,
          isArchived: false,
          defaultBranch: null,
          pushedAt: null,
          url: '',
          language: null,
        },
      ],
    })
  })

  it('reports authentication required on exit code four', async () => {
    const out = await repos(10, fake(() => ({ code: 4, stderr: 'gh: To use GitHub CLI in a GitHub Actions workflow' })).gh)

    expect(out).toEqual({ ok: false, error: { kind: 'auth-required' } })
  })

  it('reports unreachable rather than a generic failure when the network is down', async () => {
    const machine = fake(() => ({ code: 1, stderr: 'Post "https://api.github.com/graphql": connection refused' }), false)
    const out = await repos(10, machine.gh)

    expect(out).toEqual({ ok: false, error: { kind: 'unreachable', detail: 'Post "https://api.github.com/graphql": connection refused' } })
  })

  it('reports the exhausted resource when a failure coincides with a spent budget', async () => {
    const spent = {
      resources: {
        core: { limit: 5000, remaining: 4000, reset: 100 },
        graphql: { limit: 5000, remaining: 0, reset: 200 },
        search: { limit: 30, remaining: 30, reset: 300 },
      },
    }
    const machine = fake((args) => (args[0] === 'api' ? { stdout: JSON.stringify(spent) } : { code: 1, stderr: 'HTTP 403' }))
    const out = await repos(10, machine.gh)

    expect(out).toEqual({ ok: false, error: { kind: 'rate-limited', resource: 'graphql', resetAt: 200_000 } })
  })

  it('reports a timed out call rather than a failure', async () => {
    const out = await repos(10, fake(() => ({ code: 'timeout' })).gh)

    expect(out).toMatchObject({ ok: false, error: { kind: 'timed-out' } })
  })

  it('fails when the listing is not an array', async () => {
    const out = await repos(10, fake(() => ({ stdout: '{"nope":true}' })).gh)

    expect(out).toMatchObject({ ok: false, error: { kind: 'unreadable' } })
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

function named(name: string): string {
  return JSON.stringify([{ nameWithOwner: name }])
}

describe('allRepos', () => {
  function machine(handler: (args: string[]) => Partial<GhOutput>) {
    return fake((args) => {
      if (args[0] === 'repo' && args[1] === 'list') return handler(args)
      if (args[1] === 'user/orgs') return { stdout: 'botpress\niolotech\n' }
      if (String(args[1]).startsWith('user/repos')) return { stdout: JSON.stringify({ nameWithOwner: 'friend/shared' }) }
      return {}
    })
  }

  it('unions the personal, collaborating and organisation listings without repeating one', async () => {
    const listing = machine((args) => ({ stdout: named(args[2] === undefined || args[2].startsWith('--') ? 'me/own' : `${args[2]}/thing`) }))
    const out = await allRepos(10, listing.gh)

    expect(out.ok && out.value.map((repo) => repo.nameWithOwner)).toEqual([
      'botpress/thing',
      'friend/shared',
      'iolotech/thing',
      'me/own',
      'The-Blue-Space-Australia/thing',
      'webarts/thing',
    ])
  })

  it('asks each organisation the account never joined but works in', async () => {
    const listing = machine(() => ({ stdout: '[]' }))
    await allRepos(10, listing.gh)

    const owners = listing.calls.filter((args) => args[0] === 'repo' && args[2] && !args[2].startsWith('--')).map((args) => args[2])

    expect(owners).toEqual(['botpress', 'iolotech', 'webarts', 'The-Blue-Space-Australia'])
  })

  it('keeps the listing when one organisation refuses rather than losing every repo', async () => {
    const listing = machine((args) => (args[2] === 'botpress' ? { code: 1, stderr: 'HTTP 404' } : { stdout: named('me/own') }))
    const out = await allRepos(10, listing.gh)

    expect(out).toMatchObject({ ok: true })
    expect(out.ok && out.value.some((repo) => repo.owner === 'botpress')).toBe(false)
  })

  it('fails when the account listing itself fails, because that is the signed out case', async () => {
    const listing = machine(() => ({ code: 4 }))
    const out = await allRepos(10, listing.gh)

    expect(out).toEqual({ ok: false, error: { kind: 'auth-required' } })
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
