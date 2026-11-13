import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aiChoiceOf, saveSettings } from '../../shared/settings'
import { aiRun, failureOf } from './run'
import { cliOf } from './cli'
import { statusOf } from './status'

let dir: string
const kept = { PATH: process.env.PATH, HOME: process.env.HOME, KEY: process.env.ANTHROPIC_API_KEY }

function fake(name: string, script: string) {
  const file = path.join(dir, 'bin', name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 })
}

const auth = (method: string, loggedIn = true) => `if [ "$1" = auth ]; then echo '{"loggedIn": ${loggedIn}, "authMethod": "${method}", "subscriptionType": "max"}'; exit 0; fi`

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-'))
  process.env.PATH = `${path.join(dir, 'bin')}:/bin:/usr/bin`
  process.env.HOME = dir
})

afterEach(() => {
  process.env.PATH = kept.PATH
  process.env.HOME = kept.HOME
  if (kept.KEY === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = kept.KEY
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('aiChoiceOf', () => {
  it('starts disconnected on claude with the default models', () => {
    expect(aiChoiceOf(undefined)).toEqual({ connected: false, provider: 'claude', models: { claude: 'haiku', codex: 'gpt-6-luna' } })
  })

  it('keeps a saved choice and refuses junk', () => {
    expect(aiChoiceOf({ connected: true, provider: 'codex', models: { codex: ' gpt-6-sol ', claude: 4 } })).toEqual({ connected: true, provider: 'codex', models: { claude: 'haiku', codex: 'gpt-6-sol' } })
    expect(aiChoiceOf({ connected: 'yes', provider: 'gemini' }).provider).toBe('claude')
  })
})

describe('cli', () => {
  it('finds a binary on the PATH and strips every API key from the env', async () => {
    fake('claude', 'exit 0')
    fake('codex', 'echo "a=${ANTHROPIC_API_KEY:-} b=${ANTHROPIC_AUTH_TOKEN:-} c=${OPENAI_API_KEY:-} d=${CODEX_API_KEY:-}"')
    expect(cliOf('claude')?.bin).toBe(path.join(dir, 'bin', 'claude'))
    Object.assign(process.env, { ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', OPENAI_API_KEY: 'k', CODEX_API_KEY: 'k' })
    const out = await cliOf('codex')?.exec([], '', { cwd: dir, timeoutMs: 5000 })
    for (const key of ['ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY']) delete process.env[key]
    expect(out?.stdout.trim()).toBe('a= b= c= d=')
  })

  it('reports claude missing when nothing is installed', async () => {
    expect((await statusOf('claude')).login).toBe('missing')
  })
})

describe('statusOf', () => {
  it('accepts a claude subscription and refuses an API key', async () => {
    fake('claude', auth('claude.ai'))
    expect(await statusOf('claude')).toEqual({ provider: 'claude', login: 'ready', detail: 'max plan', models: ['haiku', 'sonnet', 'opus'] })
    fake('claude', auth('api_key'))
    expect((await statusOf('claude')).login).toBe('api-key')
    fake('claude', auth('none', false))
    expect((await statusOf('claude')).login).toBe('logged-out')
    fake('claude', 'echo "unknown command" >&2; exit 1')
    expect((await statusOf('claude')).login).toBe('unreadable')
  })

  it('reads the codex login and its listed models', async () => {
    const models = `if [ "$1" = debug ]; then echo '{"models":[{"slug":"gpt-6-luna","visibility":"list"},{"slug":"hidden","visibility":"hide"}]}'; exit 0; fi`
    fake('codex', `${models}\necho "Logged in using ChatGPT" >&2`)
    expect(await statusOf('codex')).toEqual({ provider: 'codex', login: 'ready', detail: 'ChatGPT plan', models: ['gpt-6-luna'] })
    fake('codex', `${models}\necho "Logged in using an API key - sk-abc" >&2`)
    expect(await statusOf('codex')).toMatchObject({ login: 'api-key', detail: '' })
    fake('codex', `${models}\necho "Not logged in" >&2; exit 1`)
    expect((await statusOf('codex')).login).toBe('logged-out')
  })
})

describe('aiRun', () => {
  it('runs nothing until an AI is connected', async () => {
    fake('claude', `touch ${dir}/ran`)
    expect(await aiRun(dir)('hi', dir)).toMatchObject({ code: 'not-connected' })
    expect(fs.existsSync(path.join(dir, 'ran'))).toBe(false)
  })

  it('sends the prompt on stdin to the chosen model with no API key in reach', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-leak'
    fake('claude', `${auth('claude.ai')}\necho "args=$* key=\${ANTHROPIC_API_KEY:-none} said=$(cat)"`)
    saveSettings(path.join(dir, 'settings.json'), { ai: { connected: true, provider: 'claude', models: { claude: 'sonnet', codex: 'gpt-6-luna' } } })
    const out = await aiRun(dir)('hello', dir)
    expect(out).toMatchObject({ code: 0, cli: 'claude' })
    expect(out.stdout).toContain('args=--print --model sonnet')
    expect(out.stdout).toContain('key=none said=hello')
  })

  it('refuses a cli signed in with an API key before sending anything', async () => {
    fake('claude', `${auth('api_key_helper')}\ntouch ${dir}/ran`)
    saveSettings(path.join(dir, 'settings.json'), { ai: { connected: true, provider: 'claude', models: { claude: 'haiku', codex: 'gpt-6-luna' } } })
    const out = await aiRun(dir)('hi', dir)
    expect(failureOf(out)).toMatchObject({ kind: 'logged-out', cli: 'claude' })
    expect(fs.existsSync(path.join(dir, 'ran'))).toBe(false)
  })
})
