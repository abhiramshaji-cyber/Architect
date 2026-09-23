import { describe, expect, it } from 'vitest'
import type { GitResult, GitStatus, Head } from '../../shared/types'
import { gitText } from './git-segment'
import { registerSegment, segmentList } from './segments'

function status(over: Partial<GitStatus> = {}): GitResult<GitStatus> {
  return {
    ok: true,
    value: {
      head: { kind: 'branch', branch: 'main', commit: 'abcdef1234567890' },
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      dirty: false,
      ...over,
    },
  }
}

describe('gitText', () => {
  it('shows the branch alone on a clean repo level with its upstream', () => {
    expect(gitText(status())).toBe('main')
  })

  it('marks a dirty worktree', () => {
    expect(gitText(status({ dirty: true }))).toBe('main [+]')
  })

  it('counts ahead and behind against an upstream', () => {
    expect(gitText(status({ ahead: 2, behind: 1 }))).toBe('main 2 ahead 1 behind')
  })

  it('shows only the side that is nonzero', () => {
    expect(gitText(status({ ahead: 3 }))).toBe('main 3 ahead')
    expect(gitText(status({ behind: 4 }))).toBe('main 4 behind')
  })

  it('omits ahead and behind when there is no upstream', () => {
    expect(gitText(status({ upstream: null, ahead: 7, behind: 9, dirty: true }))).toBe('main [+]')
  })

  it('names the short commit on a detached head', () => {
    const head: Head = { kind: 'detached', commit: 'abcdef1234567890' }
    expect(gitText(status({ head, upstream: null }))).toBe('detached at abcdef12')
  })

  it('shows the branch of a repo with no commits yet', () => {
    const head: Head = { kind: 'branch', branch: 'main', commit: null }
    expect(gitText(status({ head, upstream: null }))).toBe('main')
  })

  it('truncates a very long branch name and keeps the state beside it', () => {
    const head: Head = { kind: 'branch', branch: 'feat/' + 'a'.repeat(120), commit: null }
    expect(gitText(status({ head, dirty: true, ahead: 1 }))).toBe(
      'feat/aaaaaaaaaaaaaaaaaa… [+] 1 ahead'
    )
  })

  it('renders nothing when the project is not a git repo', () => {
    expect(gitText({ ok: false, error: { kind: 'not-a-repo', root: '/tmp/x' } })).toBe('')
  })

  it('renders nothing when no project is open', () => {
    expect(gitText(null)).toBe('')
  })

  it('renders nothing when the head names neither a branch nor a commit', () => {
    expect(gitText(status({ head: { kind: 'branch', branch: '', commit: null } }))).toBe('')
    expect(gitText(status({ head: { kind: 'detached', commit: '' } }))).toBe('')
  })

  it('leaves an empty segment for the statusline filter to drop', () => {
    const unregister = registerSegment({ id: 'test.git', order: 5, text: gitText(null) })
    expect(segmentList().filter((segment) => segment.text).map((s) => s.id)).not.toContain('test.git')
    unregister()
  })
})
