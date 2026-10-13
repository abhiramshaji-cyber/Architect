import { describe, expect, it } from 'vitest'
import { type Repo, sessionRoot } from './session'

const home = '/Users/me'
const main: Repo = { top: '/Users/me/repo', common: '/Users/me/repo/.git' }
const tree: Repo = { top: '/Users/me/repo/.claude/worktrees/fix', common: '/Users/me/repo/.git' }
const other: Repo = { top: '/Users/me/other', common: '/Users/me/other/.git' }
const all = () => true
const none = () => false

describe('sessionRoot', () => {
  it('uses the cwd when nothing was edited', () => {
    expect(sessionRoot({ cwd: '/Users/me/repo/pkg/a', cwdRepo: main, file: null, fileRepo: null, home }, all)).toBe('/Users/me/repo/pkg/a')
  })

  it('keeps the cwd for a file inside it', () => {
    const place = { cwd: '/Users/me/repo/pkg/a', cwdRepo: main, file: '/Users/me/repo/pkg/a/x.ts', fileRepo: main, home }
    expect(sessionRoot(place, all)).toBe('/Users/me/repo/pkg/a')
  })

  it('never widens to the toplevel for a file elsewhere in the same checkout', () => {
    const place = { cwd: '/Users/me/repo/pkg/a', cwdRepo: main, file: '/Users/me/repo/pkg/b/x.ts', fileRepo: main, home }
    expect(sessionRoot(place, all)).toBe('/Users/me/repo/pkg/a')
  })

  it('mirrors the cwd subfolder into the worktree that was edited', () => {
    const place = { cwd: '/Users/me/repo/pkg/a', cwdRepo: main, file: `${tree.top}/pkg/a/x.ts`, fileRepo: tree, home }
    expect(sessionRoot(place, all)).toBe(`${tree.top}/pkg/a`)
  })

  it('falls back to the worktree toplevel when the mirrored folder is missing', () => {
    const place = { cwd: '/Users/me/repo/pkg/a', cwdRepo: main, file: `${tree.top}/x.ts`, fileRepo: tree, home }
    expect(sessionRoot(place, none)).toBe(tree.top)
  })

  it('uses the edited toplevel for a different repository', () => {
    const place = { cwd: '/Users/me/repo', cwdRepo: main, file: '/Users/me/other/x.ts', fileRepo: other, home }
    expect(sessionRoot(place, all)).toBe(other.top)
  })

  it('stays on the cwd for an edit outside any repository', () => {
    const place = { cwd: '/Users/me/repo', cwdRepo: main, file: '/tmp/x.ts', fileRepo: null, home }
    expect(sessionRoot(place, all)).toBe('/Users/me/repo')
  })

  it('refuses the home folder and the filesystem root', () => {
    expect(sessionRoot({ cwd: home, cwdRepo: null, file: null, fileRepo: null, home }, all)).toBeNull()
    expect(sessionRoot({ cwd: '/', cwdRepo: null, file: null, fileRepo: null, home }, all)).toBeNull()
  })

  it('moves from the home folder to the repository being edited', () => {
    const place = { cwd: home, cwdRepo: null, file: '/Users/me/other/x.ts', fileRepo: other, home }
    expect(sessionRoot(place, all)).toBe(other.top)
  })
})
