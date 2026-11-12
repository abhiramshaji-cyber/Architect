import fs from 'node:fs'
import path from 'node:path'
import type { IpcResult } from '../../shared/types'

export function launchArgs(argv: string[], defaultApp: boolean): string[] {
  return argv.slice(defaultApp ? 2 : 1).filter((arg) => arg !== '' && !arg.startsWith('-'))
}

export function folderAt(cwd: string, arg: string): IpcResult<string> {
  const target = path.resolve(cwd, arg)
  try {
    if (!fs.statSync(target).isDirectory()) return { ok: false, error: `${target} is a file, not a folder` }
    return { ok: true, value: fs.realpathSync(target) }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, error: `${target} does not exist` }
    return { ok: false, error: `${target} could not be read: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export function sameFolder(claimed: Iterable<string>, root: string): string {
  for (const held of claimed) {
    try {
      if (held === root || fs.realpathSync(held) === root) return held
    } catch {}
  }
  return root
}
