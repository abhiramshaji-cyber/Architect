import { describe, expect, it } from 'vitest'
import { mergeHooks } from './claude-hooks.mjs'

const command = 'node "/Users/me/.architect/bin/architect-mcp.mjs" hook'
const ours = { type: 'command', command, timeout: 5 }

describe('mergeHooks', () => {
  it('adds both hooks to empty settings', () => {
    expect(mergeHooks({}, command)).toEqual({
      hooks: {
        SessionStart: [{ hooks: [ours] }],
        PostToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [ours] }],
      },
    })
  })

  it('keeps existing settings and hooks', () => {
    const theirs = { matcher: 'Bash', hooks: [{ type: 'command', command: 'lint' }] }
    const merged = mergeHooks({ model: 'opus', hooks: { PostToolUse: [theirs], Stop: [] } }, command)
    expect(merged.model).toBe('opus')
    expect(merged.hooks.Stop).toEqual([])
    expect(merged.hooks.PostToolUse[0]).toEqual(theirs)
    expect(merged.hooks.PostToolUse).toHaveLength(2)
  })

  it('never duplicates on reinstall', () => {
    const once = mergeHooks({}, command)
    expect(mergeHooks(once, command)).toEqual(once)
  })

  it('replaces a stale entry of ours instead of adding a second', () => {
    const stale = { hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [ours, { type: 'command', command: 'fmt' }] }] } }
    const merged = mergeHooks(stale, command)
    expect(merged.hooks.PostToolUse).toEqual([
      { matcher: 'Edit', hooks: [{ type: 'command', command: 'fmt' }] },
      { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [ours] },
    ])
  })

  it('refuses shapes it does not understand', () => {
    expect(mergeHooks([], command)).toBeNull()
    expect(mergeHooks({ hooks: [] }, command)).toBeNull()
    expect(mergeHooks({ hooks: { SessionStart: {} } }, command)).toBeNull()
  })
})
