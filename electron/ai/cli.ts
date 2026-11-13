import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Provider } from '../../shared/settings'

const MAX_OUTPUT = 8 * 1024 * 1024
const KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY']

const FALLBACKS: Record<Provider, () => string[]> = {
  claude: () => [path.join(os.homedir(), '.local', 'bin', 'claude'), path.join(os.homedir(), '.claude', 'local', 'claude')],
  codex: () => ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'],
}

export type CliOutput = { code: number | 'missing' | 'timeout'; stdout: string; stderr: string }

export type CliOptions = { cwd: string; timeoutMs: number; signal?: AbortSignal }

export type Cli = { bin: string; exec: (args: string[], input: string, options: CliOptions) => Promise<CliOutput> }

function executable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function keyless(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !KEYS.includes(key)))
}

function exec(bin: string, args: string[], input: string, { cwd, timeoutMs, signal }: CliOptions): Promise<CliOutput> {
  return new Promise((resolve) => {
    const options = { cwd, env: keyless(process.env), maxBuffer: MAX_OUTPUT, timeout: timeoutMs, windowsHide: true, signal }

    const child = execFile(bin, args, options, (error, stdout, stderr) => {
      if (!error) return resolve({ code: 0, stdout, stderr })

      const failure = error as { code?: unknown; killed?: boolean }
      if (failure.code === 'ENOENT') return resolve({ code: 'missing', stdout, stderr })
      if (failure.killed === true) return resolve({ code: 'timeout', stdout, stderr })

      resolve({ code: typeof failure.code === 'number' ? failure.code : 1, stdout, stderr })
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(input)
  })
}

export function cliOf(provider: Provider): Cli | null {
  const name = process.platform === 'win32' ? `${provider}.exe` : provider
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter((dir) => dir !== '')
  const bin = [...dirs.map((dir) => path.join(dir, name)), ...FALLBACKS[provider]()].find(executable)
  return bin ? { bin, exec: (args, input, options) => exec(bin, args, input, options) } : null
}
