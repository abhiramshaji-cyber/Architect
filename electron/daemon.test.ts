import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Architecture, Decision, Request, Response } from '../shared/types'
import { createDaemon } from './daemon'

type OmitId<T> = T extends unknown ? Omit<T, 'id'> : never
type RequestInput = OmitId<Request>

const h1 = '#'
const h2 = '##'
const h3 = '###'

const fixture = (components: string) => `${h1} Test

A test architecture.

${h2} Components

${components}

${h2} Dependencies

${h2} Forbidden

${h2} Packages

`

const component = (id: string) => `${h3} ${id}\ndoes things\nowns: \`${id}/**\`\n`

let tmpRoot: string
let socketPath: string
let daemon: ReturnType<typeof createDaemon>

function writeArchitect(root: string, content: string) {
  fs.writeFileSync(path.join(root, 'architect.md'), content)
}

async function client(path: string) {
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const sock = net.createConnection(path)
    sock.once('connect', () => resolve(sock))
    sock.once('error', reject)
  })

  const waiters = new Map<string, (res: Response) => void>()
  const received: Response[] = []
  let buf = ''
  socket.on('data', (chunk) => {
    buf += chunk.toString()
    let idx: number
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (!line) continue
      const res = JSON.parse(line) as Response
      received.push(res)
      waiters.get(res.id)?.(res)
      waiters.delete(res.id)
    }
  })

  return {
    socket,
    received,
    request(req: RequestInput): Promise<Response> {
      return new Promise((resolve) => {
        const id = randomUUID()
        waiters.set(id, resolve)
        socket.write(`${JSON.stringify({ ...req, id } as Request)}\n`)
      })
    },
    send(line: string) {
      socket.write(`${line}\n`)
    },
    reply(id: string): Promise<Response> {
      return new Promise((resolve) => waiters.set(id, resolve))
    },
    close() {
      socket.destroy()
    },
  }
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-daemon-'))
  socketPath = path.join(tmpRoot, 'sock-dir', 'nested', 'sock')
})

afterEach(async () => {
  await daemon?.close()
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('socket lifecycle', () => {
  it('creates the parent directory before binding', async () => {
    expect(fs.existsSync(path.dirname(socketPath))).toBe(false)
    daemon = createDaemon({ socketPath })
    await expect(daemon.listen()).resolves.toBeUndefined()
  })

  it('unlinks a stale socket file before binding', async () => {
    fs.mkdirSync(path.dirname(socketPath), { recursive: true })
    fs.writeFileSync(socketPath, '')
    daemon = createDaemon({ socketPath })
    await expect(daemon.listen()).resolves.toBeUndefined()
  })

  it('refuses to steal the socket from a live daemon', async () => {
    const live = createDaemon({ socketPath })
    await live.listen()
    daemon = createDaemon({ socketPath })
    await expect(daemon.listen()).rejects.toThrow(/already running/i)
    await live.close()
  })

  it('recovers a socket left behind by a process killed without cleanup', async () => {
    fs.mkdirSync(path.dirname(socketPath), { recursive: true })
    const child = spawn(process.execPath, [
      '-e',
      `require('net').createServer(()=>{}).listen(${JSON.stringify(socketPath)}, () => console.log('up'))`,
    ])
    await new Promise<void>((resolve) => child.stdout?.once('data', () => resolve()))
    child.kill('SIGKILL')
    await new Promise((resolve) => setTimeout(resolve, 200))

    daemon = createDaemon({ socketPath })
    await expect(daemon.listen()).resolves.toBeUndefined()
  })

  it('reads ARCHITECT_SOCKET when no explicit socketPath is given', async () => {
    process.env.ARCHITECT_SOCKET = socketPath
    try {
      daemon = createDaemon({})
      await expect(daemon.listen()).resolves.toBeUndefined()
    } finally {
      delete process.env.ARCHITECT_SOCKET
    }
  })
})

describe('project resolution', () => {
  it('returns a clear error for a cwd with no architecture', async () => {
    daemon = createDaemon({ socketPath })
    await daemon.listen()
    const c = await client(socketPath)
    const res = await c.request({ op: 'get_architecture', cwd: tmpRoot })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/no architecture/i)
    c.close()
  })

  it('resolves a nested cwd by walking up to architect.md', async () => {
    writeArchitect(tmpRoot, fixture(component('api')))
    const nested = path.join(tmpRoot, 'a', 'b', 'c')
    fs.mkdirSync(nested, { recursive: true })
    daemon = createDaemon({ socketPath })
    await daemon.listen()
    const c = await client(socketPath)
    const res = await c.request({ op: 'get_architecture', cwd: nested })
    expect(res.ok).toBe(true)
    if (res.ok) expect((res.result as { title: string }).title).toBe('Test')
    c.close()
  })

  it('notifies subscribers when an mcp call registers a project', async () => {
    writeArchitect(tmpRoot, fixture(component('api')))
    daemon = createDaemon({ socketPath })
    const seen: { root: string; title: string }[][] = []
    daemon.onProjects((p) => seen.push(p))
    await daemon.listen()

    expect(daemon.projects()).toEqual([])

    const c = await client(socketPath)
    await c.request({ op: 'get_architecture', cwd: tmpRoot })
    c.close()

    expect(seen.at(-1)).toEqual([{ root: tmpRoot, title: 'Test' }])
  })

  it('remembers registered projects across a restart', async () => {
    writeArchitect(tmpRoot, fixture(component('api')))
    daemon = createDaemon({ socketPath })
    await daemon.listen()
    const c = await client(socketPath)
    await c.request({ op: 'get_architecture', cwd: tmpRoot })
    c.close()
    await daemon.close()

    daemon = createDaemon({ socketPath })
    await daemon.listen()
    expect(daemon.projects()).toEqual([{ root: tmpRoot, title: 'Test' }])
  })

  it('drops a remembered project whose architect.md is gone or malformed', async () => {
    writeArchitect(tmpRoot, fixture(component('api')))
    daemon = createDaemon({ socketPath })
    await daemon.listen()
    const c = await client(socketPath)
    await c.request({ op: 'get_architecture', cwd: tmpRoot })
    c.close()
    await daemon.close()

    fs.rmSync(path.join(tmpRoot, 'architect.md'))

    daemon = createDaemon({ socketPath })
    await daemon.listen()
    expect(daemon.projects()).toEqual([])
  })

  it('does not notify again for an already registered project', async () => {
    writeArchitect(tmpRoot, fixture(component('api')))
    daemon = createDaemon({ socketPath })
    let calls = 0
    daemon.onProjects(() => calls++)
    await daemon.listen()

    const c = await client(socketPath)
    await c.request({ op: 'get_architecture', cwd: tmpRoot })
    await c.request({ op: 'get_architecture', cwd: tmpRoot })
    c.close()

    expect(calls).toBe(1)
  })
})

describe('correctness requirements', () => {
  beforeEach(() => {
    writeArchitect(tmpRoot, fixture(component('api') + component('db')))
  })

  it('answers check_change immediately while propose_change is blocked', async () => {
    daemon = createDaemon({ socketPath, proposalTimeoutMs: 60_000 })
    await daemon.listen()
    const c = await client(socketPath)

    const proposePromise = c.request({
      op: 'propose_change',
      cwd: tmpRoot,
      proposal: { kind: 'edge', from: 'api', to: 'db' },
      rationale: 'wiring',
    })

    const checkRes = await c.request({ op: 'check_change', cwd: tmpRoot, from: 'api', to: 'db' })
    expect(checkRes.ok).toBe(true)
    if (checkRes.ok) expect(checkRes.result).toEqual({ status: 'unknown' })

    const pending = daemon.pending()
    expect(pending).toHaveLength(1)
    await daemon.decide(pending[0]!.id, true)
    await proposePromise
    c.close()
  })

  it('resolves pending after timeout, then lets await_proposal be called twice without duplicating the entry', async () => {
    daemon = createDaemon({ socketPath, proposalTimeoutMs: 30 })
    await daemon.listen()
    const c = await client(socketPath)

    const res = await c.request({
      op: 'propose_change',
      cwd: tmpRoot,
      proposal: { kind: 'edge', from: 'api', to: 'db' },
      rationale: 'wiring',
    })
    expect(res.ok).toBe(true)
    const decision = res.ok ? (res.result as Decision) : null
    expect(decision).toEqual({ status: 'pending', id: expect.any(String) })
    const id = (decision as { status: 'pending'; id: string }).id

    expect(daemon.pending()).toHaveLength(1)

    const await1 = c.request({ op: 'await_proposal', cwd: tmpRoot, proposalId: id })
    const await2 = c.request({ op: 'await_proposal', cwd: tmpRoot, proposalId: id })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(daemon.pending()).toHaveLength(1)

    await daemon.decide(id, true)

    const [r1, r2] = await Promise.all([await1, await2])
    expect(r1.ok && r1.result).toEqual({ status: 'approved' })
    expect(r2.ok && r2.result).toEqual({ status: 'approved' })
    expect(daemon.pending()).toHaveLength(0)
    c.close()
  })

  it('ignores the watcher event triggered by its own approval write', async () => {
    daemon = createDaemon({ socketPath, proposalTimeoutMs: 60_000 })
    let changeCount = 0
    daemon.onChange(() => {
      changeCount += 1
    })
    await daemon.listen()
    await daemon.open(tmpRoot)
    const c = await client(socketPath)

    const proposePromise = c.request({
      op: 'propose_change',
      cwd: tmpRoot,
      proposal: { kind: 'edge', from: 'api', to: 'db' },
      rationale: 'wiring',
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const pending = daemon.pending()
    await daemon.decide(pending[0]!.id, true)
    await proposePromise

    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(changeCount).toBe(1)

    const content = fs.readFileSync(path.join(tmpRoot, 'architect.md'), 'utf8')
    expect(content).toMatch(/api -> db/)
    c.close()
  })

  it('collapses two proposals for the same edge into one pending entry', async () => {
    daemon = createDaemon({ socketPath, proposalTimeoutMs: 60_000 })
    await daemon.listen()
    const c = await client(socketPath)

    const p1 = c.request({
      op: 'propose_change',
      cwd: tmpRoot,
      proposal: { kind: 'edge', from: 'api', to: 'db' },
      rationale: 'first',
    })
    const p2 = c.request({
      op: 'propose_change',
      cwd: tmpRoot,
      proposal: { kind: 'edge', from: 'api', to: 'db' },
      rationale: 'second',
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(daemon.pending()).toHaveLength(1)

    await daemon.decide(daemon.pending()[0]!.id, true)
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.ok && r1.result).toEqual({ status: 'approved' })
    expect(r2.ok && r2.result).toEqual({ status: 'approved' })
    c.close()
  })

  it('keeps the previous good architecture when architect.md becomes malformed', async () => {
    daemon = createDaemon({ socketPath })
    let changeCount = 0
    daemon.onChange(() => {
      changeCount += 1
    })
    await daemon.listen()
    const good = await daemon.open(tmpRoot)

    writeArchitect(tmpRoot, '# Broken\n\n## Components\n\n### api\nowns: `x/**`\n\n## Dependencies\n\n- api -> ghost\n')
    await new Promise((resolve) => setTimeout(resolve, 500))

    const c = await client(socketPath)
    const res = await c.request({ op: 'get_architecture', cwd: tmpRoot })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.result).toEqual(good)
    expect(changeCount).toBe(0)
    c.close()
  })

  it('does not strand the queue when a client disconnects mid proposal', async () => {
    daemon = createDaemon({ socketPath, proposalTimeoutMs: 60_000 })
    await daemon.listen()
    const c = await client(socketPath)

    void c.request({
      op: 'propose_change',
      cwd: tmpRoot,
      proposal: { kind: 'edge', from: 'api', to: 'db' },
      rationale: 'wiring',
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const [entry] = daemon.pending()
    expect(entry).toBeDefined()
    c.close()
    await new Promise((resolve) => setTimeout(resolve, 20))

    await expect(daemon.decide(entry!.id, true)).resolves.toBeUndefined()

    const c2 = await client(socketPath)
    const res = await c2.request({ op: 'check_change', cwd: tmpRoot, from: 'api', to: 'db' })
    expect(res.ok).toBe(true)
    expect(daemon.pending()).toHaveLength(0)
    c2.close()
  })

  it('rejects cleanly when the proposal targets a component deleted while it was pending', async () => {
    daemon = createDaemon({ socketPath, proposalTimeoutMs: 60_000 })
    await daemon.listen()
    await daemon.open(tmpRoot)
    const c = await client(socketPath)

    const proposePromise = c.request({
      op: 'propose_change',
      cwd: tmpRoot,
      proposal: { kind: 'file', path: 'db/x.ts', component: 'db' },
      rationale: 'new file',
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const [entry] = daemon.pending()
    expect(entry).toBeDefined()

    writeArchitect(tmpRoot, fixture(component('api')))
    await new Promise((resolve) => setTimeout(resolve, 500))

    await daemon.decide(entry!.id, true)
    const res = await proposePromise
    expect(res.ok).toBe(true)
    if (res.ok) {
      const decision = res.result as Decision
      expect(decision.status).toBe('rejected')
      if (decision.status === 'rejected') expect(decision.reason).toMatch(/db/)
    }
    expect(daemon.pending()).toHaveLength(0)
    c.close()
  })

  it('applies an approved file proposal to the component reassigned at decide time', async () => {
    daemon = createDaemon({ socketPath, proposalTimeoutMs: 60_000 })
    await daemon.listen()
    await daemon.open(tmpRoot)
    const c = await client(socketPath)

    const proposePromise = c.request({
      op: 'propose_change',
      cwd: tmpRoot,
      proposal: { kind: 'file', path: 'shared.ts', component: 'api' },
      rationale: 'reassign me',
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const [entry] = daemon.pending()

    await daemon.decide(entry!.id, true, undefined, 'db')
    const res = await proposePromise
    expect(res.ok).toBe(true)
    if (res.ok) expect((res.result as Decision).status).toBe('approved')

    const architecture = await daemon.open(tmpRoot)
    const api = architecture.components.find((comp) => comp.id === 'api')!
    const db = architecture.components.find((comp) => comp.id === 'db')!
    expect(api.owns).not.toContain('shared.ts')
    expect(db.owns).toContain('shared.ts')
    c.close()
  })

  it('rejects cleanly when reassigned to a component that does not exist', async () => {
    daemon = createDaemon({ socketPath, proposalTimeoutMs: 60_000 })
    await daemon.listen()
    await daemon.open(tmpRoot)
    const c = await client(socketPath)

    const proposePromise = c.request({
      op: 'propose_change',
      cwd: tmpRoot,
      proposal: { kind: 'file', path: 'shared.ts', component: 'api' },
      rationale: 'reassign me',
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const [entry] = daemon.pending()

    await daemon.decide(entry!.id, true, undefined, 'ghost')
    const res = await proposePromise
    expect(res.ok).toBe(true)
    if (res.ok) {
      const decision = res.result as Decision
      expect(decision.status).toBe('rejected')
      if (decision.status === 'rejected') expect(decision.reason).toMatch(/ghost/)
    }
    expect(daemon.pending()).toHaveLength(0)
    c.close()
  })

  it('ignores component on a rejection and on a non file proposal', async () => {
    daemon = createDaemon({ socketPath, proposalTimeoutMs: 60_000 })
    await daemon.listen()
    const c = await client(socketPath)

    const rejectPromise = c.request({
      op: 'propose_change',
      cwd: tmpRoot,
      proposal: { kind: 'edge', from: 'api', to: 'db' },
      rationale: 'wiring',
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    let [entry] = daemon.pending()
    await daemon.decide(entry!.id, false, 'nope', 'db')
    const rejectRes = await rejectPromise
    expect(rejectRes.ok).toBe(true)
    if (rejectRes.ok) expect(rejectRes.result).toEqual({ status: 'rejected', reason: 'nope' })

    const componentPromise = c.request({
      op: 'propose_change',
      cwd: tmpRoot,
      proposal: { kind: 'component', id: 'worker', purpose: 'does work', owns: ['worker/**'] },
      rationale: 'new component',
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    ;[entry] = daemon.pending()
    await daemon.decide(entry!.id, true, undefined, 'db')
    const componentRes = await componentPromise
    expect(componentRes.ok).toBe(true)
    if (componentRes.ok) expect((componentRes.result as Decision).status).toBe('approved')

    const architecture = await daemon.open(tmpRoot)
    expect(architecture.components.some((comp) => comp.id === 'worker')).toBe(true)
    c.close()
  })
})

describe('project persistence', () => {
  it('keeps remembering a project whose architect.md could not be read', async () => {
    const good = fs.mkdtempSync(path.join(tmpRoot, 'good-'))
    const gone = path.join(tmpRoot, 'gone')
    writeArchitect(good, fixture(component('api')))

    const statePath = path.join(path.dirname(socketPath), 'projects.json')
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    fs.writeFileSync(statePath, JSON.stringify([good, gone]))

    daemon = createDaemon({ socketPath })
    await daemon.listen()

    expect(daemon.projects().map((p) => p.root)).toEqual([good])
    expect(JSON.parse(fs.readFileSync(statePath, 'utf8'))).toEqual([good, gone])
  })
})

describe('pending persistence', () => {
  let pendingPath: string

  beforeEach(() => {
    pendingPath = path.join(path.dirname(socketPath), 'pending.json')
    writeArchitect(tmpRoot, fixture(component('api') + component('db')))
  })

  function writeStore(entries: unknown) {
    fs.mkdirSync(path.dirname(pendingPath), { recursive: true })
    fs.writeFileSync(pendingPath, typeof entries === 'string' ? entries : JSON.stringify(entries))
  }

  it('saves a pending proposal, reloads it, and approves it for a waiter that arrived after the restart', async () => {
    const first = createDaemon({ socketPath, proposalTimeoutMs: 30 })
    await first.listen()
    const c1 = await client(socketPath)

    const res = await c1.request({
      op: 'propose_change',
      cwd: tmpRoot,
      proposal: { kind: 'edge', from: 'api', to: 'db' },
      rationale: 'wiring',
    })
    const id = res.ok ? (res.result as { status: 'pending'; id: string }).id : ''
    expect(JSON.parse(fs.readFileSync(pendingPath, 'utf8'))).toEqual([
      { id, projectRoot: tmpRoot, proposal: { kind: 'edge', from: 'api', to: 'db' }, rationale: 'wiring', createdAt: expect.any(Number) },
    ])
    c1.close()
    await first.close()

    daemon = createDaemon({ socketPath, proposalTimeoutMs: 60_000 })
    await daemon.listen()
    expect(daemon.pending().map((p) => p.id)).toEqual([id])

    const c2 = await client(socketPath)
    const awaited = c2.request({ op: 'await_proposal', cwd: tmpRoot, proposalId: id })
    await new Promise((resolve) => setTimeout(resolve, 20))

    await daemon.decide(id, true)

    const decided = await awaited
    expect(decided.ok && decided.result).toEqual({ status: 'approved' })
    expect(daemon.pending()).toHaveLength(0)
    expect(JSON.parse(fs.readFileSync(pendingPath, 'utf8'))).toEqual([])
    expect(fs.readFileSync(path.join(tmpRoot, 'architect.md'), 'utf8')).toMatch(/api -> db/)
    c2.close()
  })

  it('keeps both proposals on disk while two are pending at once', async () => {
    daemon = createDaemon({ socketPath, proposalTimeoutMs: 60_000 })
    await daemon.listen()
    const c = await client(socketPath)

    void c.request({ op: 'propose_change', cwd: tmpRoot, proposal: { kind: 'edge', from: 'api', to: 'db' }, rationale: 'wiring' })
    void c.request({ op: 'propose_change', cwd: tmpRoot, proposal: { kind: 'file', path: 'db/x.ts', component: 'db' }, rationale: 'new file' })
    await new Promise((resolve) => setTimeout(resolve, 20))

    const stored = JSON.parse(fs.readFileSync(pendingPath, 'utf8')) as { proposal: { kind: string } }[]
    expect(stored.map((p) => p.proposal.kind).sort()).toEqual(['edge', 'file'])
    c.close()
  })

  it('reloads a proposal whose project is gone and rejects it instead of throwing', async () => {
    const gone = path.join(tmpRoot, 'gone')
    writeStore([{ id: 'orphan', projectRoot: gone, proposal: { kind: 'edge', from: 'api', to: 'db' }, rationale: 'wiring', createdAt: 1 }])

    daemon = createDaemon({ socketPath, proposalTimeoutMs: 60_000 })
    await daemon.listen()
    expect(daemon.pending()).toHaveLength(1)

    const c = await client(socketPath)
    const awaited = c.request({ op: 'await_proposal', cwd: tmpRoot, proposalId: 'orphan' })
    await new Promise((resolve) => setTimeout(resolve, 20))

    await expect(daemon.decide('orphan', true)).resolves.toBeUndefined()

    const res = await awaited
    expect(res.ok && res.result).toEqual({ status: 'rejected', reason: `could not open ${gone}` })
    expect(daemon.pending()).toHaveLength(0)
    c.close()
  })

  it('decides a reloaded proposal that nobody is waiting on', async () => {
    writeStore([{ id: 'orphan', projectRoot: tmpRoot, proposal: { kind: 'edge', from: 'api', to: 'db' }, rationale: 'wiring', createdAt: 1 }])

    daemon = createDaemon({ socketPath })
    await daemon.listen()

    await expect(daemon.decide('orphan', true)).resolves.toBeUndefined()
    expect(daemon.pending()).toHaveLength(0)
    expect(fs.readFileSync(path.join(tmpRoot, 'architect.md'), 'utf8')).toMatch(/api -> db/)
  })

  it('starts with an empty inbox when the store is unreadable', async () => {
    const corrupt = [
      '',
      'not json',
      '{"id":"x"}',
      JSON.stringify([1, null, 'x']),
      JSON.stringify([{ id: 'a', projectRoot: tmpRoot, proposal: { kind: 'ghost' }, rationale: '', createdAt: 0 }]),
      JSON.stringify([{ id: 'a', projectRoot: tmpRoot, proposal: { kind: 'edge', from: 'api' }, rationale: '', createdAt: 0 }]),
    ]

    for (const contents of corrupt) {
      writeStore(contents)
      const d = createDaemon({ socketPath })
      await d.listen()
      expect(d.pending()).toEqual([])
      await d.close()
    }
  })

  it('keeps the valid entries of a partly corrupt store and drops unknown fields', async () => {
    writeStore([
      { id: 'bad', proposal: { kind: 'edge' } },
      { id: 'good', projectRoot: tmpRoot, proposal: { kind: 'edge', from: 'api', to: 'db' }, rationale: 'wiring', createdAt: 1, extra: 'ignored' },
    ])

    daemon = createDaemon({ socketPath })
    await daemon.listen()

    expect(daemon.pending()).toEqual([
      { id: 'good', projectRoot: tmpRoot, proposal: { kind: 'edge', from: 'api', to: 'db' }, rationale: 'wiring', createdAt: 1 },
    ])
  })

  it('reattaches a reproposing agent to the reloaded proposal instead of duplicating it', async () => {
    writeStore([{ id: 'orphan', projectRoot: tmpRoot, proposal: { kind: 'edge', from: 'api', to: 'db' }, rationale: 'wiring', createdAt: 1 }])

    daemon = createDaemon({ socketPath, proposalTimeoutMs: 60_000 })
    await daemon.listen()

    const c = await client(socketPath)
    const awaited = c.request({ op: 'propose_change', cwd: tmpRoot, proposal: { kind: 'edge', from: 'api', to: 'db' }, rationale: 'wiring' })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(daemon.pending().map((p) => p.id)).toEqual(['orphan'])

    await daemon.decide('orphan', true)

    const res = await awaited
    expect(res.ok && res.result).toEqual({ status: 'approved' })
    c.close()
  })

  it('rejects a reloaded proposal that nobody is waiting on', async () => {
    writeStore([{ id: 'orphan', projectRoot: tmpRoot, proposal: { kind: 'edge', from: 'api', to: 'db' }, rationale: 'wiring', createdAt: 1 }])

    daemon = createDaemon({ socketPath })
    await daemon.listen()

    await expect(daemon.decide('orphan', false, 'not now')).resolves.toBeUndefined()
    expect(daemon.pending()).toEqual([])
    expect(fs.readFileSync(path.join(tmpRoot, 'architect.md'), 'utf8')).not.toMatch(/api -> db/)
  })

  it('still queues a proposal when the store cannot be written', async () => {
    fs.mkdirSync(pendingPath, { recursive: true })

    daemon = createDaemon({ socketPath, proposalTimeoutMs: 60_000 })
    await daemon.listen()
    const c = await client(socketPath)

    void c.request({ op: 'propose_change', cwd: tmpRoot, proposal: { kind: 'edge', from: 'api', to: 'db' }, rationale: 'wiring' })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(daemon.pending()).toHaveLength(1)
    c.close()
  })
})

describe('edits', () => {
  const drafted: Architecture = {
    title: 'Drafted',
    summary: 'What the engineer intends.',
    components: [{ id: 'api', purpose: 'does things', owns: ['api/**'] }],
    edges: [],
    forbidden: [],
    packages: [],
  }

  it('serves the edits of the resolved project root over the socket', async () => {
    writeArchitect(tmpRoot, fixture(component('api')))
    const nested = path.join(tmpRoot, 'src', 'deep')
    fs.mkdirSync(nested, { recursive: true })

    daemon = createDaemon({ socketPath })
    await daemon.listen()
    const c = await client(socketPath)

    expect(await c.request({ op: 'list_edits', cwd: nested })).toMatchObject({ ok: true, result: [] })

    const created = daemon.createEdit(tmpRoot, drafted)
    daemon.handEdit(tmpRoot, created.id)

    expect(await c.request({ op: 'list_edits', cwd: nested })).toMatchObject({
      ok: true,
      result: [{ id: created.id, status: 'handed', title: 'Drafted' }],
    })
    expect(await c.request({ op: 'get_edit', cwd: nested, editId: created.id })).toMatchObject({
      ok: true,
      result: { id: created.id, status: 'handed', architecture: drafted },
    })

    c.close()
  })

  it('rejects a traversing edit id over the socket', async () => {
    writeArchitect(tmpRoot, fixture(component('api')))
    daemon = createDaemon({ socketPath })
    await daemon.listen()
    const c = await client(socketPath)

    const res = await c.request({ op: 'get_edit', cwd: tmpRoot, editId: '../../etc/passwd' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/invalid edit id/)

    c.close()
  })
})

describe('code map storage', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalKey
  })

  it('returns the scanned map even when it cannot be persisted', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'a.ts'), 'export function a() {}\n')
    fs.writeFileSync(path.join(tmpRoot, '.architect'), 'not a directory')
    daemon = createDaemon({ socketPath })

    const map = await daemon.rescan(tmpRoot)

    expect(map.root).toBe(tmpRoot)
    expect(map.folders[0]?.files.map((f) => f.path)).toContain('a.ts')
    expect(fs.existsSync(path.join(tmpRoot, '.architect', 'map.json'))).toBe(false)
  })

  it('refuses a stored map whose folders are malformed', async () => {
    fs.mkdirSync(path.join(tmpRoot, '.architect'), { recursive: true })
    fs.writeFileSync(
      path.join(tmpRoot, '.architect', 'map.json'),
      JSON.stringify({ map: { root: tmpRoot, scannedAt: 1, folders: [{ path: '', folders: [] }] }, cache: {} }),
    )
    daemon = createDaemon({ socketPath })

    expect(daemon.codeMap(tmpRoot)).toBeNull()
  })

  it('reads back a map it wrote', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'a.ts'), 'export function a() {}\n')
    daemon = createDaemon({ socketPath })

    await daemon.rescan(tmpRoot)

    expect(daemon.codeMap(tmpRoot)?.folders[0]?.files.map((f) => f.path)).toEqual(['a.ts'])
  })
})

describe('code map migration', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalKey
  })

  function writeOldMap(cache: Record<string, string>) {
    fs.mkdirSync(path.join(tmpRoot, '.architect'), { recursive: true })
    fs.writeFileSync(
      path.join(tmpRoot, '.architect', 'map.json'),
      JSON.stringify({
        map: {
          root: tmpRoot,
          scannedAt: 1,
          folders: [
            { path: '', folders: [], files: [{ path: 'a.ts', functions: [{ name: 'a', line: 1, description: 'old' }] }] },
          ],
        },
        cache,
      }),
    )
  }

  it('treats a map stored before the call graph as never scanned', async () => {
    writeOldMap({})
    daemon = createDaemon({ socketPath })

    expect(daemon.codeMap(tmpRoot)).toBeNull()
  })

  it('keeps description cache hits across the migration', async () => {
    const source = 'export function a() {}\n'
    fs.writeFileSync(path.join(tmpRoot, 'a.ts'), source)
    const hash = createHash('sha256').update(`a.ts\0a\0${source}`).digest('hex')
    writeOldMap({ [hash]: 'already described' })
    daemon = createDaemon({ socketPath })

    const map = await daemon.rescan(tmpRoot)

    expect(map.folders[0]?.files[0]?.functions[0]?.description).toBe('already described')
  })

  it('refuses a stored map whose calls are not indices', async () => {
    fs.mkdirSync(path.join(tmpRoot, '.architect'), { recursive: true })
    fs.writeFileSync(
      path.join(tmpRoot, '.architect', 'map.json'),
      JSON.stringify({
        map: {
          root: tmpRoot,
          scannedAt: 1,
          folders: [
            { path: '', folders: [], files: [{ path: 'a.ts', functions: [{ name: 'a', line: 1, endLine: 1, description: '', calls: ['b'] }] }] },
          ],
        },
        cache: {},
      }),
    )
    daemon = createDaemon({ socketPath })

    expect(daemon.codeMap(tmpRoot)).toBeNull()
  })
})

describe('readSource', () => {
  beforeEach(async () => {
    writeArchitect(tmpRoot, fixture(component('api')))
    daemon = createDaemon({ socketPath })
    await daemon.open(tmpRoot)
  })

  it('refuses a root that is not an open project', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'a.ts'), 'one\ntwo\n')
    const parent = path.dirname(tmpRoot)
    const inParent = path.join(tmpRoot, '..', `outside-${randomUUID()}.ts`)
    fs.writeFileSync(inParent, 'secret\n')

    try {
      expect(await daemon.readSource(parent, path.basename(inParent), 1, 1)).toBe('')
      expect(await daemon.readSource(parent, `${path.basename(tmpRoot)}/a.ts`, 1, 1)).toBe('')
      expect(await daemon.readSource(path.parse(tmpRoot).root, path.relative(path.parse(tmpRoot).root, inParent), 1, 1)).toBe('')
      expect(await daemon.readSource(path.join(tmpRoot, 'sub'), 'a.ts', 1, 1)).toBe('')
    } finally {
      fs.rmSync(inParent, { force: true })
    }
  })

  it('returns the requested inclusive line range', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'a.ts'), 'one\ntwo\nthree\nfour\n')

    expect(await daemon.readSource(tmpRoot, 'a.ts', 2, 3)).toBe('two\nthree')
  })

  it('refuses a path that escapes the root', async () => {
    const outside = path.join(tmpRoot, '..', `escape-${randomUUID()}.ts`)
    fs.writeFileSync(outside, 'secret\n')

    try {
      expect(await daemon.readSource(tmpRoot, `../${path.basename(outside)}`, 1, 1)).toBe('')
      expect(await daemon.readSource(tmpRoot, outside, 1, 1)).toBe('')
    } finally {
      fs.rmSync(outside, { force: true })
    }
  })

  it('refuses a symlink that leaves the root', async () => {
    const outside = path.join(tmpRoot, '..', `linked-${randomUUID()}.ts`)
    fs.writeFileSync(outside, 'secret\n')
    fs.symlinkSync(outside, path.join(tmpRoot, 'link.ts'))

    try {
      expect(await daemon.readSource(tmpRoot, 'link.ts', 1, 1)).toBe('')
    } finally {
      fs.rmSync(outside, { force: true })
    }
  })

  it('returns empty for a missing file', async () => {
    expect(await daemon.readSource(tmpRoot, 'nope.ts', 1, 5)).toBe('')
  })

  it('clamps a range that runs past the end of the file', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'a.ts'), 'one\ntwo\n')

    expect(await daemon.readSource(tmpRoot, 'a.ts', 2, 900)).toBe('two\n')
    expect(await daemon.readSource(tmpRoot, 'a.ts', 0, 1)).toBe('one')
    expect(await daemon.readSource(tmpRoot, 'a.ts', 40, 90)).toBe('')
    expect(await daemon.readSource(tmpRoot, 'a.ts', Number.NaN, 2)).toBe('')
  })

  it('caps the returned span', async () => {
    const lines = Array.from({ length: 900 }, (_, n) => `line${n + 1}`)
    fs.writeFileSync(path.join(tmpRoot, 'big.ts'), lines.join('\n'))

    const span = await daemon.readSource(tmpRoot, 'big.ts', 1, 900)

    expect(span.split('\n')).toHaveLength(400)
    expect(span.split('\n').at(-1)).toBe('line400')
  })
})

describe('malformed lines', () => {
  const silent = [
    'not json at all {',
    '42',
    '"just a string"',
    'null',
    '[1, 2, 3]',
    '{"op":"get_architecture","cwd":"/tmp"}',
    '{"id":123,"op":"get_architecture","cwd":"/tmp"}',
    '',
  ]

  const answered = [
    { id: '', line: '{"id":"","op":"teleport"}' },
    { id: 'no-op', line: '{"id":"no-op","cwd":"/tmp"}' },
    { id: 'bad-payload', line: '{"id":"bad-payload","op":"get_architecture"}' },
    { id: 'unknown-op', line: '{"id":"unknown-op","op":"teleport","cwd":"/tmp"}' },
    { id: 'wrong-types', line: '{"id":"wrong-types","op":"check_change","cwd":"/tmp","from":1,"to":2}' },
    { id: 'huge', line: `{"id":"huge","op":"teleport","pad":"${'x'.repeat(1_000_000)}"}` },
  ]

  it('ignores a garbage line and keeps serving the connection', async () => {
    writeArchitect(tmpRoot, fixture(component('api')))
    daemon = createDaemon({ socketPath })
    await daemon.listen()

    const c = await client(socketPath)
    c.send('}{ not json')
    const res = await c.request({ op: 'get_architecture', cwd: tmpRoot })

    expect(res.ok).toBe(true)
    expect(c.received).toHaveLength(1)
    c.close()
  })

  it('answers an unknown op with an error carrying the same id', async () => {
    daemon = createDaemon({ socketPath })
    await daemon.listen()

    const c = await client(socketPath)
    const waiting = c.reply('unknown-op')
    c.send('{"id":"unknown-op","op":"teleport","cwd":"/tmp"}')
    const res = await waiting

    expect(res).toMatchObject({ id: 'unknown-op', ok: false })
    if (!res.ok) expect(res.error).toMatch(/invalid request/i)
    c.close()
  })

  it('serves a valid request sent immediately after a malformed one', async () => {
    writeArchitect(tmpRoot, fixture(component('api')))
    daemon = createDaemon({ socketPath })
    await daemon.listen()

    const c = await client(socketPath)
    c.send('{"id":"unknown-op","op":"teleport","cwd":"/tmp"}')
    const res = await c.request({ op: 'get_architecture', cwd: tmpRoot })

    expect(res.ok).toBe(true)
    if (res.ok) expect((res.result as { title: string }).title).toBe('Test')
    c.close()
  })

  it('survives every shape of malformed line and still serves a valid request', async () => {
    writeArchitect(tmpRoot, fixture(component('api')))
    daemon = createDaemon({ socketPath })
    await daemon.listen()

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const c = await client(socketPath)

    const replies = answered.map((a) => c.reply(a.id))
    for (const line of [...silent, ...answered.map((a) => a.line)]) c.send(line)

    for (const res of await Promise.all(replies)) expect(res.ok).toBe(false)

    const res = await c.request({ op: 'get_architecture', cwd: tmpRoot })
    expect(res.ok).toBe(true)
    expect(c.received.map((r) => r.id).sort()).toEqual([...answered.map((a) => a.id), res.id].sort())
    expect(logged).toHaveBeenCalledTimes(silent.length - 1)

    logged.mockRestore()
    c.close()
  })
})
