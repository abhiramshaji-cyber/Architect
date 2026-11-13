import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isMain } from './entry.js'

describe('isMain', () => {
  let dir = ''

  function script(name: string) {
    dir = mkdtempSync(join(tmpdir(), 'architect entry \u00e9 '))
    const file = join(dir, name)
    writeFileSync(file, '')
    return file
  }

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })

  it('matches a path with spaces and unicode', () => {
    const file = script('bridge \u00fc.js')
    expect(isMain(pathToFileURL(file).href, file)).toBe(true)
  })

  it('matches a script run through a symlink', () => {
    const file = script('bridge.js')
    const link = join(dir, 'architect-mcp.mjs')
    symlinkSync(file, link)
    expect(isMain(pathToFileURL(file).href, link)).toBe(true)
  })

  it('matches a relative script path', () => {
    const file = script('bridge.js')
    expect(isMain(pathToFileURL(file).href, relative(process.cwd(), file))).toBe(true)
  })

  it('rejects a different script', () => {
    const file = script('bridge.js')
    const other = join(dir, 'other.js')
    writeFileSync(other, '')
    expect(isMain(pathToFileURL(file).href, other)).toBe(false)
  })

  it('rejects a missing or nonexistent script path', () => {
    const file = script('bridge.js')
    expect(isMain(pathToFileURL(file).href, undefined)).toBe(false)
    expect(isMain(pathToFileURL(file).href, '')).toBe(false)
    expect(isMain(pathToFileURL(file).href, join(dir, 'gone.js'))).toBe(false)
  })

  it.runIf(process.platform === 'win32')('matches forward slashes and a lowercase drive letter on Windows', () => {
    const file = script('bridge.js')
    const variant = file.replace(/^[A-Z]:/, (d) => d.toLowerCase()).replaceAll('\\', '/')
    expect(isMain(pathToFileURL(file).href, variant)).toBe(true)
  })
})
