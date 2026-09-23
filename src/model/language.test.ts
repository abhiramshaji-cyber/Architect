import { afterEach, describe, expect, it, vi } from 'vitest'
import { extensionOf, languageFor } from './language'

describe('extensionOf', () => {
  it('reads the extension, not the rest of the path, and folds case', () => {
    expect(extensionOf('src/view/App.tsx')).toBe('tsx')
    expect(extensionOf('electron/daemon.ts')).toBe('ts')
    expect(extensionOf('a/b.TS')).toBe('ts')
  })

  it('is empty for a dotfile, a dotted folder and a file with no extension', () => {
    expect(extensionOf('.gitignore')).toBe('')
    expect(extensionOf('my.folder/Makefile')).toBe('')
    expect(extensionOf('LICENSE')).toBe('')
    expect(extensionOf('')).toBe('')
  })
})

describe('languageFor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('covers every dialect the source listing has to highlight', async () => {
    for (const path of [
      'a.ts',
      'a.mts',
      'a.cts',
      'a.tsx',
      'a.js',
      'a.mjs',
      'a.cjs',
      'a.jsx',
      'a.json',
      'a.jsonc',
      'a.md',
      'a.markdown',
      'a.css',
    ]) {
      await expect(languageFor(path)).resolves.not.toBeNull()
    }
  })

  it('loads a grammar on first use and hands the same one to every later file of that type', async () => {
    const first = languageFor('docs/one.md')
    const second = languageFor('docs/two.md')
    expect(second).toBe(first)
    expect(await second).toBe(await first)
  })

  it('resolves to null for a file it cannot highlight, rather than guessing', async () => {
    await expect(languageFor('a.bin')).resolves.toBeNull()
    await expect(languageFor('LICENSE')).resolves.toBeNull()
    await expect(languageFor('.gitignore')).resolves.toBeNull()
  })

  it('treats an extension that names an Object prototype member as no grammar at all', async () => {
    await expect(languageFor('a.constructor')).resolves.toBeNull()
    await expect(languageFor('a.hasownproperty')).resolves.toBeNull()
  })

  it('falls back to plain text and reports it when a grammar fails to load', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.resetModules()
    vi.doMock('@codemirror/lang-css', () => {
      throw new Error('chunk unreachable')
    })

    const fresh = await import('./language')
    await expect(fresh.languageFor('a.css')).resolves.toBeNull()
    await expect(fresh.languageFor('b.css')).resolves.toBeNull()
    expect(reported).toHaveBeenCalledTimes(2)

    vi.doUnmock('@codemirror/lang-css')
  })
})
