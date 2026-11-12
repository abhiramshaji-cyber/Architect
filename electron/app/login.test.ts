import { describe, expect, it } from 'vitest'
import { SOCKET_PATH } from '../../shared/socket'
import { type LoginRun, opensAtLogin } from './login'

const mac: LoginRun = {
  packaged: true,
  exePath: '/Applications/Architect.app/Contents/MacOS/Architect',
  socketPath: SOCKET_PATH,
  platform: 'darwin',
}

const win: LoginRun = {
  packaged: true,
  exePath: 'C:\\Users\\me\\AppData\\Local\\Programs\\architect\\Architect.exe',
  socketPath: SOCKET_PATH,
  platform: 'win32',
  localAppData: 'C:\\Users\\me\\AppData\\Local',
}

describe('opensAtLogin', () => {
  it('registers the installed mac app on the default socket', () => {
    expect(opensAtLogin(mac)).toBe(true)
  })

  it('skips an unpackaged dev run', () => {
    expect(opensAtLogin({ ...mac, packaged: false, exePath: '/wt/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' })).toBe(false)
  })

  it('skips a packaged app outside /Applications', () => {
    expect(opensAtLogin({ ...mac, exePath: '/repo/dist/mac-arm64/Architect.app/Contents/MacOS/Architect' })).toBe(false)
    expect(opensAtLogin({ ...mac, exePath: '/Applications/Architect.app/../Evil.app/Contents/MacOS/Architect' })).toBe(false)
  })

  it('skips any socket other than the default', () => {
    expect(opensAtLogin({ ...mac, socketPath: '/tmp/x/sock' })).toBe(false)
    expect(opensAtLogin({ ...mac, socketPath: `${SOCKET_PATH}-dev` })).toBe(false)
  })

  it('registers the per user windows install, ignoring case', () => {
    expect(opensAtLogin(win)).toBe(true)
    expect(opensAtLogin({ ...win, exePath: win.exePath.toUpperCase() })).toBe(true)
  })

  it('skips windows runs outside the install folder or without LOCALAPPDATA', () => {
    expect(opensAtLogin({ ...win, exePath: 'C:\\repo\\dist\\win-unpacked\\Architect.exe' })).toBe(false)
    expect(opensAtLogin({ ...win, localAppData: undefined })).toBe(false)
  })

  it('skips linux, where login items are unsupported', () => {
    expect(opensAtLogin({ ...mac, platform: 'linux', exePath: '/home/me/.local/share/architect/Architect.AppImage' })).toBe(false)
  })
})
