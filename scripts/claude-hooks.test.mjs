import { describe, expect, it } from 'vitest'
import { mergeHooks } from './claude-hooks.mjs'

const command = 'node "/Users/me/.architect/bin/architect-mcp.mjs" hook'
const ours = { type: 'command', command, timeout: 5 }
const gate = { type: 'command', command, timeout: 600 }

describe('mergeHooks', () => {
  it('adds the session hooks and the long review gate to empty settings', () => {
    expect(mergeHooks({}, command)).toEqual({
      hooks: {
        SessionStart: [{ hooks: [ours] }],
        PostToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [ours] }],
        PreToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [gate] }],
      },
    })
  })

  it('upgrades a gate of ours whose timeout is too short to wait for a review', () => {
    const short = { hooks: { PreToolUse: [{ matcher: 'Edit|Write|MultiEdit', hooks: [ours] }] } }
    expect(mergeHooks(short, command).hooks.PreToolUse).toEqual([{ matcher: 'Edit|Write|MultiEdit', hooks: [gate] }])
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
