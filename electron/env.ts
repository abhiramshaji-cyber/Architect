import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const MARK = '__ARCHITECT_PATH__'
const TIMEOUT_MS = 5_000
const COMMON_DIRS = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin', '/opt/local/bin', '/opt/local/sbin']

export type ReadShell = (shell: string, env: NodeJS.ProcessEnv) => Promise<string>

const readShell: ReadShell = (shell, env) =>
  new Promise((resolve) => {
    const script = `printf ${MARK}; printenv PATH; printf ${MARK}`
    execFile(shell, ['-ilc', script], { env, timeout: TIMEOUT_MS, encoding: 'utf8' }, (_error, stdout) => resolve(stdout ?? ''))
  })

export function shellPath(stdout: string): string | null {
  const parts = stdout.split(MARK)
  const found = parts.length >= 3 ? parts.at(-2)?.trim() : ''
  return found ? found : null
}

export function mergedPath(entries: Array<string | null | undefined>, delimiter = path.delimiter): string {
  const dirs = entries.flatMap((entry) => entry?.split(delimiter) ?? []).filter((dir) => dir !== '')
  return [...new Set(dirs)].join(delimiter)
}

export async function loginPath(env: NodeJS.ProcessEnv, read: ReadShell = readShell): Promise<string> {
  const shell = env.SHELL || os.userInfo().shell || '/bin/sh'
  const login = shellPath(await read(shell, env))
  return mergedPath([login, env.PATH, COMMON_DIRS.join(path.delimiter)])
}
