import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { folderAt, launchArgs, sameFolder } from './launch'

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'architect-launch-')))
const project = path.join(base, 'project')
const file = path.join(base, 'notes.txt')
const link = path.join(base, 'link')
fs.mkdirSync(project)
fs.writeFileSync(file, 'x')
fs.symlinkSync(project, link)

afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

describe('launchArgs', () => {
  it('drops the binary of a packaged app', () => {
    expect(launchArgs(['/Applications/Architect.app/Contents/MacOS/Architect', '/a', 'b'], false)).toEqual(['/a', 'b'])
  })

  it('drops electron and the app path when run unpackaged', () => {
    expect(launchArgs(['electron', '.', '/a'], true)).toEqual(['/a'])
  })

  it('drops switches, the macOS process serial number and empty args', () => {
    expect(launchArgs(['Architect', '-psn_0_12345', '--allow-file-access-from-files', '', '/a'], false)).toEqual(['/a'])
  })

  it('returns nothing when no path was passed', () => {
    expect(launchArgs(['Architect'], false)).toEqual([])
  })
})

describe('folderAt', () => {
  it('accepts an absolute folder', () => {
    expect(folderAt('/', project)).toEqual({ ok: true, value: project })
  })

  it('resolves a relative path against the caller cwd', () => {
    expect(folderAt(base, 'project')).toEqual({ ok: true, value: project })
    expect(folderAt(path.join(project, 'nested'), '..')).toEqual({ ok: true, value: project })
  })

  it('ignores a trailing slash', () => {
    expect(folderAt('/', `${project}/`)).toEqual({ ok: true, value: project })
  })

  it('follows a symlink to the real folder', () => {
    expect(folderAt('/', link)).toEqual({ ok: true, value: project })
  })

  it('rejects a missing path', () => {
    expect(folderAt(base, 'gone')).toEqual({ ok: false, error: `${path.join(base, 'gone')} does not exist` })
  })

  it('rejects a path under a file', () => {
    expect(folderAt('/', path.join(file, 'inner'))).toEqual({ ok: false, error: `${path.join(file, 'inner')} does not exist` })
  })

  it('rejects a file', () => {
    expect(folderAt('/', file)).toEqual({ ok: false, error: `${file} is a file, not a folder` })
  })
})

describe('sameFolder', () => {
  it('reuses a claimed root that names the same folder', () => {
    expect(sameFolder(['/elsewhere', link], project)).toBe(link)
    expect(sameFolder([project], project)).toBe(project)
  })

  it('keeps the root when nothing claims it', () => {
    expect(sameFolder([path.join(base, 'gone'), file], project)).toBe(project)
  })
})
