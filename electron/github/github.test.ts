import { describe, expect, it } from 'vitest'
import { auth, type GhOutput, type GhRun, ghEnv, branches, rates, repos, token } from './github'

function fake(handler: (args: string[]) => Partial<GhOutput>, online = true) {
  const calls: string[][] = []
  let reached = 0

  const run: GhRun = async (args) => {
    calls.push(args)
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
    reaches: () => reached,
  }
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
