import { createConnection } from 'node:net'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { readSettings } from '../shared/settings.js'
import { SETTINGS_PATH, SOCKET_PATH } from '../shared/socket.js'
import { EDIT_TIMEOUT_MS, HOOK_DEADLINE_MS, type CodeChange, type Decision, type Request } from '../shared/types.js'

const GATE_GRACE_MS = 15_000

type SessionEvent = Extract<Request, { op: 'session-event' }>

type ReviewEdit = Extract<Request, { op: 'review_edit' }>

type Fields = Record<string, unknown>

const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)

function fieldsOf(raw: string): Fields | null {
  try {
    const input: unknown = JSON.parse(raw)
    return isFields(input) ? input : null
  } catch {
    return null
  }
}

export function sessionEvent(raw: string): SessionEvent | null {
  const input = fieldsOf(raw)
  if (!input) return null

  const { cwd, session_id, hook_event_name, tool_input } = input
  const target = isFields(tool_input) ? tool_input : {}
  const where = text(cwd)
  const event = text(hook_event_name)
  if (!where || !event || event === 'PreToolUse') return null

  const file = text(target.file_path) ?? text(target.notebook_path)
  return { id: randomUUID(), op: 'session-event', cwd: where, event, session: text(session_id), file }
}

function changeOf(tool: unknown, input: Fields, file: string): CodeChange | null {
  if (tool === 'Write') return typeof input.content === 'string' ? { tool, file, content: input.content } : null

  const listed = tool === 'Edit' ? [input] : tool === 'MultiEdit' && Array.isArray(input.edits) ? input.edits : null
  if (!listed || listed.length === 0) return null

  const edits = listed.flatMap((edit: unknown) =>
    isFields(edit) && typeof edit.old_string === 'string' && typeof edit.new_string === 'string'
      ? [{ old: edit.old_string, new: edit.new_string, all: edit.replace_all === true }]
      : [],
  )
  return edits.length === listed.length ? { tool: tool as 'Edit' | 'MultiEdit', file, edits } : null
}

export function reviewEdit(raw: string): ReviewEdit | null {
  const input = fieldsOf(raw)
  if (!input || input.hook_event_name !== 'PreToolUse') return null

  const cwd = text(input.cwd)
  const target = isFields(input.tool_input) ? input.tool_input : {}
  const file = text(target.file_path)
  if (!cwd || !file) return null

  const change = changeOf(input.tool_name, target, path.resolve(cwd, file))
  return change && { id: randomUUID(), op: 'review_edit', cwd, change }
}

function decisionOf(line: string): Decision | null {
  const reply = fieldsOf(line)
  const result = reply?.ok === true && isFields(reply.result) ? reply.result : null
  if (result?.status === 'approved') return { status: 'approved' }
  if (result?.status === 'rejected' && typeof result.reason === 'string') return { status: 'rejected', reason: result.reason }
  if (result?.status === 'pending' && typeof result.id === 'string') return { status: 'pending', id: result.id }
  return null
}

export function gateOutput(decision: Decision | null): string {
  if (!decision) return ''

  const [permission, reason] =
    decision.status === 'approved'
      ? ['allow', 'Approved in Architect.']
      : decision.status === 'rejected'
        ? ['deny', decision.reason]
        : ['ask', 'Nobody answered in Architect in time, so Claude Code asks instead.']
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: permission, permissionDecisionReason: reason },
  })
}

async function readStdin(): Promise<string> {
  let raw = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) raw += chunk
  return raw
}

function deliver(event: SessionEvent, socketPath: string): Promise<void> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath)
    socket.once('connect', () => socket.end(`${JSON.stringify(event)}\n`))
    socket.once('close', () => resolve())
    socket.once('error', () => resolve())
  })
}

export function ask(request: ReviewEdit, socketPath: string): Promise<Decision | null> {
  return new Promise((resolve) => {
    let buffer = ''
    const socket = createConnection(socketPath)
    socket.setEncoding('utf8')
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', (chunk: string) => {
      buffer += chunk
      const end = buffer.indexOf('\n')
      if (end === -1) return
      resolve(decisionOf(buffer.slice(0, end)))
      socket.destroy()
    })
    socket.once('close', () => resolve(null))
    socket.once('error', () => resolve(null))
  })
}

function emit(out: string): Promise<void> {
  return new Promise((resolve) => (out ? process.stdout.write(out, () => resolve()) : resolve()))
}

export async function runHook(socketPath = SOCKET_PATH, settingsPath = SETTINGS_PATH): Promise<void> {
  const deadline = setTimeout(() => process.exit(0), HOOK_DEADLINE_MS)
  deadline.unref()
  const raw = await readStdin()

  const gate = reviewEdit(raw)
  if (gate) {
    clearTimeout(deadline)
    if (!readSettings(settingsPath).review) return
    setTimeout(() => process.exit(0), EDIT_TIMEOUT_MS + GATE_GRACE_MS).unref()
    return emit(gateOutput(await ask(gate, socketPath)))
  }

  const event = sessionEvent(raw)
  if (event) await deliver(event, socketPath)
}
