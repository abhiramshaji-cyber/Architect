import { describe, expect, it } from 'vitest'
import type { CodeMap } from '../../shared/types'
import { MAX_AUTO_DRAFT_FILES, placeSkip, sizeSkip } from './skip'

const home = '/Users/me'

function mapOf(files: number): CodeMap {
  const file = { path: 'a.ts', functions: [] }
  return { root: '/r', scannedAt: 0, folders: [{ path: '', folders: [], files: Array(files).fill(file) }] }
}

describe('auto draft skip', () => {
  it('skips the home dir, the filesystem root, and folders of repos', () => {
    expect(placeSkip({ root: home, home, inRepo: false, nestedRepos: 0 })).toBe('broad')
    expect(placeSkip({ root: '/', home, inRepo: false, nestedRepos: 0 })).toBe('broad')
    expect(placeSkip({ root: '/Users/me/GitHub', home, inRepo: false, nestedRepos: 2 })).toBe('container')
    expect(placeSkip({ root: '/Users/me/GitHub/app', home, inRepo: true, nestedRepos: 0 })).toBeNull()
    expect(placeSkip({ root: '/Users/me/notes', home, inRepo: false, nestedRepos: 1 })).toBeNull()
  })

  it('skips a code map over the file cap', () => {
    expect(sizeSkip(mapOf(MAX_AUTO_DRAFT_FILES))).toBeNull()
    expect(sizeSkip(mapOf(MAX_AUTO_DRAFT_FILES + 1))).toBe('too-big')
  })
})
