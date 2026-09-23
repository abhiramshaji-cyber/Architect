import { describe, expect, it } from 'vitest'
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
  it('covers every dialect the source listing has to highlight', () => {
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
      expect(languageFor(path)).not.toBeNull()
    }
  })

  it('is null for a file it cannot highlight, rather than guessing', () => {
    expect(languageFor('a.bin')).toBeNull()
    expect(languageFor('LICENSE')).toBeNull()
    expect(languageFor('.gitignore')).toBeNull()
  })
})
