import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loginPath, mergedPath, shellPath } from './env'

const LAUNCHD = '/usr/bin:/bin:/usr/sbin:/sbin'
const MARK = '__ARCHITECT_PATH__'

describe('shellPath', () => {
  it('reads the path between the markers past rc noise', () => {
    expect(shellPath(`welcome back\n${MARK}/opt/homebrew/bin:/usr/bin\n${MARK}bye`)).toBe('/opt/homebrew/bin:/usr/bin')
  })

  it('returns null when the shell printed nothing usable', () => {
    expect(shellPath('')).toBe(null)
    expect(shellPath(`${MARK}/usr/bin`)).toBe(null)
    expect(shellPath(`${MARK}\n${MARK}`)).toBe(null)
  })
})

describe('mergedPath', () => {
  it('keeps the first occurrence of each directory in order', () => {
    expect(mergedPath(['/a:/b', '/b:/c:', null, undefined, '/a:/d'], ':')).toBe('/a:/b:/c:/d')
  })
})

describe('loginPath', () => {
  it('puts the login shell path first, then the inherited path, then common package dirs', async () => {
    const read = async () => `${MARK}/custom/bin:/usr/bin${MARK}`
    const dirs = (await loginPath({ SHELL: '/bin/zsh', PATH: LAUNCHD }, read)).split(':')

    expect(dirs.slice(0, 2)).toEqual(['/custom/bin', '/usr/bin'])
    expect(dirs).toEqual(expect.arrayContaining(['/bin', '/sbin', '/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin']))
    expect(new Set(dirs).size).toBe(dirs.length)
  })

  it('still finds homebrew and macports when the shell fails', async () => {
    const dirs = (await loginPath({ SHELL: '/bin/zsh', PATH: LAUNCHD }, async () => '')).split(':')

    expect(dirs.slice(0, 4)).toEqual(LAUNCHD.split(':'))
    expect(dirs).toEqual(expect.arrayContaining(['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin']))
  })

  it('reads a custom path from a real login shell profile under a launchd env', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-env-'))
    fs.writeFileSync(path.join(home, '.profile'), 'echo noise\nexport PATH="/custom/tools:$PATH"\n')

    const resolved = await loginPath({ HOME: home, SHELL: '/bin/sh', PATH: LAUNCHD })

    expect(resolved.split(':')[0]).toBe('/custom/tools')
    fs.rmSync(home, { recursive: true, force: true })
  })
})
