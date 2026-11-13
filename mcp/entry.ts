import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function isMain(moduleUrl: string, scriptPath: string | undefined = process.argv[1]): boolean {
  if (!scriptPath) return false
  try {
    return realpathSync.native(fileURLToPath(moduleUrl)) === realpathSync.native(scriptPath)
  } catch {
    return false
  }
}
