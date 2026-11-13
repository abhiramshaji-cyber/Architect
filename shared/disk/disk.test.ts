import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readText } from './read'
import { realPath } from './real'

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-disk-'))
const real = fs.realpathSync.native(base)
fs.mkdirSync(path.join(base, 'dir'))
fs.writeFileSync(path.join(base, 'dir', 'file.txt'), 'hi')
fs.symlinkSync(path.join(base, 'dir'), path.join(base, 'link'))
fs.symlinkSync(path.join(base, 'gone'), path.join(base, 'broken'))

afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

describe('realPath', () => {
  it('resolves an existing path through its links', () => {
    expect(realPath(path.join(base, 'link', 'file.txt'))).toBe(path.join(real, 'dir', 'file.txt'))
  })

  it('keeps the missing tail under the deepest existing ancestor', () => {
    expect(realPath(path.join(base, 'link', 'new', 'deeper.ts'))).toBe(path.join(real, 'dir', 'new', 'deeper.ts'))
    expect(realPath(path.join(base, 'broken'))).toBe(path.join(real, 'broken'))
  })

  it('keeps the tail when an ancestor is a file', () => {
    expect(realPath(path.join(base, 'dir', 'file.txt', 'inside'))).toBe(path.join(real, 'dir', 'file.txt', 'inside'))
  })

  it('resolves a relative path from the working directory', () => {
    expect(realPath('.')).toBe(fs.realpathSync.native(process.cwd()))
  })
})

describe('readText', () => {
  it('reads a file and answers undefined when it cannot', () => {
    expect(readText(path.join(base, 'dir', 'file.txt'))).toBe('hi')
    expect(readText(path.join(base, 'missing.txt'))).toBeUndefined()
    expect(readText(path.join(base, 'dir'))).toBeUndefined()
  })
})
