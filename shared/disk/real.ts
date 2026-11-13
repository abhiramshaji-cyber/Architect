import fs from 'node:fs'
import path from 'node:path'

export function realPath(target: string): string {
  const resolved = path.resolve(target)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    const parent = path.dirname(resolved)
    return parent === resolved ? resolved : path.join(realPath(parent), path.basename(resolved))
  }
}
