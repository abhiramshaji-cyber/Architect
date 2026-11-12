import path from 'node:path'
import { SOCKET_PATH } from '../../shared/socket'

const MAC_INSTALLED = '/Applications/Architect.app/Contents/MacOS/Architect'

export type LoginRun = {
  packaged: boolean
  exePath: string
  socketPath: string
  platform: NodeJS.Platform
  localAppData?: string
}

export function opensAtLogin(run: LoginRun): boolean {
  return run.packaged && run.socketPath === SOCKET_PATH && installed(run)
}

function installed({ exePath, platform, localAppData }: LoginRun): boolean {
  if (platform === 'darwin') return exePath === MAC_INSTALLED
  if (platform !== 'win32' || !localAppData) return false
  const programs = path.win32.resolve(localAppData, 'Programs').toLowerCase()
  const exe = path.win32.resolve(exePath).toLowerCase()
  return path.win32.dirname(path.win32.dirname(exe)) === programs && path.win32.basename(exe) === 'architect.exe'
}
