import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ask, gateOutput, reviewEdit, sessionEvent } from './hook.js'

const input = (fields: Record<string, unknown>) =>
  JSON.stringify({ cwd: '/code/app', session_id: 's1', hook_event_name: 'PreToolUse', ...fields })

describe('reviewEdit', () => {
  it('turns an Edit into a change on an absolute path', () => {
    const raw = input({ tool_name: 'Edit', tool_input: { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } })
    expect(reviewEdit(raw)).toMatchObject({
      op: 'review_edit',
      cwd: '/code/app',
      change: { tool: 'Edit', file: path.resolve('/code/app', 'src/a.ts'), edits: [{ old: 'a', new: 'b', all: false }] },
    })
  })

  it('reads a MultiEdit and a Write', () => {
    const multi = input({
      tool_name: 'MultiEdit',
      tool_input: { file_path: '/code/app/a.ts', edits: [{ old_string: 'a', new_string: 'b', replace_all: true }] },
    })
    expect(reviewEdit(multi)?.change).toEqual({ tool: 'MultiEdit', file: '/code/app/a.ts', edits: [{ old: 'a', new: 'b', all: true }] })

    const write = input({ tool_name: 'Write', tool_input: { file_path: '/code/app/a.ts', content: 'x' } })
    expect(reviewEdit(write)?.change).toEqual({ tool: 'Write', file: '/code/app/a.ts', content: 'x' })
  })

  it('ignores other events, other tools and malformed input', () => {
    expect(reviewEdit(input({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: 'a', content: 'x' } }))).toBeNull()
    expect(reviewEdit(input({ tool_name: 'Bash', tool_input: { command: 'ls' } }))).toBeNull()
    expect(reviewEdit(input({ tool_name: 'MultiEdit', tool_input: { file_path: 'a', edits: [{ old_string: 1 }] } }))).toBeNull()
    expect(reviewEdit(input({ tool_name: 'MultiEdit', tool_input: { file_path: 'a', edits: [] } }))).toBeNull()
    expect(reviewEdit(input({ tool_name: 'Write', tool_input: { content: 'x' } }))).toBeNull()
    expect(reviewEdit('not json')).toBeNull()
  })
})

describe('sessionEvent', () => {
  it('never reports a PreToolUse as a session touch', () => {
    expect(sessionEvent(input({ tool_name: 'Edit', tool_input: { file_path: 'a' } }))).toBeNull()
    expect(sessionEvent(input({ hook_event_name: 'PostToolUse', tool_input: { file_path: 'a' } }))).toMatchObject({ file: 'a' })
  })
})

describe('gateOutput', () => {
  const parsed = (out: string) => JSON.parse(out).hookSpecificOutput

  it('prints nothing when Architect passes the edit through', () => {
    expect(gateOutput(null)).toBe('')
  })

  it('maps each decision to a Claude Code permission', () => {
    expect(parsed(gateOutput({ status: 'approved' }))).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'allow' })
    expect(parsed(gateOutput({ status: 'rejected', reason: 'The user rejected this change: no' }))).toEqual({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'The user rejected this change: no',
    })
    expect(parsed(gateOutput({ status: 'pending', id: 'x' }))).toMatchObject({ permissionDecision: 'ask' })
  })
})

describe('ask', () => {
  let server: Server | null = null
  afterEach(() => server?.close())

  const request = reviewEdit(input({ tool_name: 'Write', tool_input: { file_path: '/a.ts', content: 'x' } }))!

  it('returns the decision the daemon replies with', async () => {
    const socketPath = path.join(tmpdir(), `architect-hook-${randomBytes(4).toString('hex')}.sock`)
    server = createServer((socket) =>
      socket.on('data', () => socket.write(`${JSON.stringify({ id: request.id, ok: true, result: { status: 'rejected', reason: 'no' } })}\n`)),
    )
    await new Promise<void>((resolve) => server!.listen(socketPath, resolve))

    await expect(ask(request, socketPath)).resolves.toEqual({ status: 'rejected', reason: 'no' })
  })

  it('passes through when the daemon is not running or answers with nothing', async () => {
    await expect(ask(request, path.join(tmpdir(), 'architect-hook-missing.sock'))).resolves.toBeNull()

    const socketPath = path.join(tmpdir(), `architect-hook-${randomBytes(4).toString('hex')}.sock`)
    server = createServer((socket) => socket.on('data', () => socket.write(`${JSON.stringify({ id: request.id, ok: true, result: null })}\n`)))
    await new Promise<void>((resolve) => server!.listen(socketPath, resolve))
    await expect(ask(request, socketPath)).resolves.toBeNull()
  })
})
