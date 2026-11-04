import { execFile } from 'node:child_process'

const TIMEOUT_MS = 5 * 60 * 1000
const MAX_OUTPUT = 8 * 1024 * 1024

export type ClaudeOutput = {
  code: number | 'missing' | 'timeout'
  stdout: string
  stderr: string
}

export type ClaudeRun = (prompt: string, cwd: string, timeoutMs?: number, model?: string) => Promise<ClaudeOutput>

export const runClaude: ClaudeRun = (prompt, cwd, timeoutMs = TIMEOUT_MS, model) =>
  new Promise((resolve) => {
    const options = {
      cwd,
      maxBuffer: MAX_OUTPUT,
      timeout: timeoutMs,
      windowsHide: true,
    }
    const args = model ? ['--model', model, '--print', prompt] : ['--print', prompt]

    execFile('claude', args, options, (error, stdout, stderr) => {
      if (!error) return resolve({ code: 0, stdout, stderr })

      const failure = error as { code?: unknown; killed?: boolean }
      if (failure.code === 'ENOENT') return resolve({ code: 'missing', stdout, stderr })
      if (failure.killed === true) return resolve({ code: 'timeout', stdout, stderr })

      resolve({
        code: typeof failure.code === 'number' ? failure.code : 1,
        stdout,
        stderr,
      })
    })
  })
