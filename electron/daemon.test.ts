import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Architecture, Decision, Request, Response, Verdict } from '../shared/types'
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
    if (checkRes.ok) expect(checkRes.result).toEqual({ status: 'undrawn-edge' })

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
    await new Promise((resolve) => setTimeout(resolve, 150))

    writeArchitect(tmpRoot, '# Broken\n\n## Components\n\n### api\nowns: `x/**`\n\n## Dependencies\n\n- api -> ghost\n')
    await new Promise((resolve) => setTimeout(resolve, 500))

    const c = await client(socketPath)
    const res = await c.request({ op: 'get_architecture', cwd: tmpRoot })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/unknown component in dependency: ghost/)

    const stale = await c.request({ op: 'check_change', cwd: tmpRoot, from: 'api', to: 'db' })
    expect(stale.ok && (stale.result as Verdict).status).toBe('unknown')
    expect(daemon.projects()[0]?.title).toBe(good!.title)
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

    const architecture = (await daemon.open(tmpRoot))!
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

    const architecture = (await daemon.open(tmpRoot))!
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
      expect(await daemon.readSource(parent, path.basename(inParent), 1, 1)).toMatchObject({
        lines: [],
        total: 0,
        error: 'closed'
      })
      expect(await daemon.readSource(parent, `${path.basename(tmpRoot)}/a.ts`, 1, 1)).toMatchObject({ error: 'closed' })
      expect(
        await daemon.readSource(path.parse(tmpRoot).root, path.relative(path.parse(tmpRoot).root, inParent), 1, 1)
      ).toMatchObject({ error: 'closed' })
      expect(await daemon.readSource(path.join(tmpRoot, 'sub'), 'a.ts', 1, 1)).toMatchObject({ error: 'closed' })
    } finally {
      fs.rmSync(inParent, { force: true })
    }
  })

  it('returns the requested window and the true total', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'a.ts'), 'one\ntwo\nthree\nfour\n')

    expect(await daemon.readSource(tmpRoot, 'a.ts', 2, 2)).toEqual({
      from: 2,
      lines: ['two', 'three'],
      total: 4,
      error: null
    })
  })

  it('refuses a path that escapes the root', async () => {
    const outside = path.join(tmpRoot, '..', `escape-${randomUUID()}.ts`)
    fs.writeFileSync(outside, 'secret\n')

    try {
      expect(await daemon.readSource(tmpRoot, `../${path.basename(outside)}`, 1, 1)).toMatchObject({
        lines: [],
        error: 'outside'
      })
      expect(await daemon.readSource(tmpRoot, outside, 1, 1)).toMatchObject({ lines: [], error: 'outside' })
    } finally {
      fs.rmSync(outside, { force: true })
    }
  })

  it('refuses a symlink that leaves the root', async () => {
    const outside = path.join(tmpRoot, '..', `linked-${randomUUID()}.ts`)
    fs.writeFileSync(outside, 'secret\n')
    fs.symlinkSync(outside, path.join(tmpRoot, 'link.ts'))

    try {
      expect(await daemon.readSource(tmpRoot, 'link.ts', 1, 1)).toMatchObject({ lines: [], error: 'outside' })
    } finally {
      fs.rmSync(outside, { force: true })
    }
  })

  it('refuses a missing file', async () => {
    expect(await daemon.readSource(tmpRoot, 'nope.ts', 1, 5)).toMatchObject({ lines: [], error: 'unreadable' })
  })

  it('refuses a file that is not readable text', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'bin.ts'), Buffer.from([0x68, 0x69, 0x00, 0x68, 0x69]))
    fs.writeFileSync(path.join(tmpRoot, 'bad.ts'), Buffer.from([0x68, 0x69, 0xff, 0xfe]))

    expect(await daemon.readSource(tmpRoot, 'bin.ts', 1, 5)).toMatchObject({ lines: [], error: 'binary' })
    expect(await daemon.readSource(tmpRoot, 'bad.ts', 1, 5)).toMatchObject({ lines: [], error: 'binary' })
  })

  it('reports an empty file as zero lines', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'empty.ts'), '')

    expect(await daemon.readSource(tmpRoot, 'empty.ts', 1, 10)).toEqual({
      from: 1,
      lines: [],
      total: 0,
      error: null
    })
  })

  it('returns an empty window when the file is shorter than the request', async () => {
    fs.writeFileSync(path.join(tmpRoot, 'a.ts'), 'one\ntwo\n')

    expect(await daemon.readSource(tmpRoot, 'a.ts', 2, 900)).toEqual({
      from: 2,
      lines: ['two'],
      total: 2,
      error: null
    })
    expect(await daemon.readSource(tmpRoot, 'a.ts', 0, 1)).toEqual({
      from: 1,
      lines: ['one'],
      total: 2,
      error: null
    })
    expect(await daemon.readSource(tmpRoot, 'a.ts', 40, 90)).toEqual({
      from: 40,
      lines: [],
      total: 2,
      error: null
    })
    expect(await daemon.readSource(tmpRoot, 'a.ts', 1, 0)).toEqual({
      from: 1,
      lines: [],
      total: 2,
      error: null
    })
    expect(await daemon.readSource(tmpRoot, 'a.ts', Number.NaN, 2)).toMatchObject({ lines: [], error: 'range' })
    expect(await daemon.readSource(tmpRoot, 'a.ts', 1, Number.POSITIVE_INFINITY)).toMatchObject({ error: 'range' })
  })

  it('caps the window but still reports the whole file', async () => {
    const lines = Array.from({ length: 900 }, (_, n) => `line${n + 1}`)
    fs.writeFileSync(path.join(tmpRoot, 'big.ts'), lines.join('\n'))

    const window = await daemon.readSource(tmpRoot, 'big.ts', 1, 900)

    expect(window.lines).toHaveLength(400)
    expect(window.lines.at(-1)).toBe('line400')
    expect(window.total).toBe(900)
  })

  it('windows across the old 400 line limit', async () => {
    const lines = Array.from({ length: 402 }, (_, n) => `line${n + 1}`)
    fs.writeFileSync(path.join(tmpRoot, 'edge.ts'), `${lines.join('\n')}\n`)

    expect(await daemon.readSource(tmpRoot, 'edge.ts', 399, 1)).toMatchObject({ lines: ['line399'], total: 402 })
    expect(await daemon.readSource(tmpRoot, 'edge.ts', 400, 1)).toMatchObject({ lines: ['line400'], total: 402 })
    expect(await daemon.readSource(tmpRoot, 'edge.ts', 401, 2)).toMatchObject({
      lines: ['line401', 'line402'],
      total: 402
    })
  })

  it('sees a file that grew between calls', async () => {
    const file = path.join(tmpRoot, 'grow.ts')
    fs.writeFileSync(file, 'one\n')

    expect(await daemon.readSource(tmpRoot, 'grow.ts', 1, 10)).toMatchObject({ lines: ['one'], total: 1 })

    fs.appendFileSync(file, 'two\nthree\n')

    expect(await daemon.readSource(tmpRoot, 'grow.ts', 1, 10)).toMatchObject({
      lines: ['one', 'two', 'three'],
      total: 3
    })
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

describe('architect.md parse failure', () => {
  const good = `${h1} Test

A test architecture.

${h2} Components

${component('api')}${component('db')}
${h2} Dependencies

- api -> db

${h2} Forbidden

- db -> api : layers only point down

${h2} Packages

`

  const broken = good.replace('- api -> db', '<<<<<<< HEAD')
  const badLine = good.split('\n').indexOf('- api -> db') + 1

  function settle() {
    return new Promise((resolve) => setTimeout(resolve, 200))
  }

  async function daemonOn(root: string) {
    daemon = createDaemon({ socketPath, proposalTimeoutMs: 60_000 })
    await daemon.listen()
    await daemon.open(root)
    await settle()
  }

  it('reports the parser message and its line number on the project', async () => {
    writeArchitect(tmpRoot, good)
    await daemonOn(tmpRoot)

    const seen: { root: string; parseError?: string }[][] = []
    daemon.onProjects((p) => seen.push(p))

    writeArchitect(tmpRoot, broken)
    await settle()

    expect(daemon.projects()[0]?.parseError).toMatch(new RegExp(`malformed dependency on line ${badLine}: <<<<<<< HEAD`))
    expect(daemon.projects()[0]?.parseError).toContain(path.join(tmpRoot, 'architect.md'))
    expect(seen.at(-1)?.[0]?.parseError).toBe(daemon.projects()[0]?.parseError)
  })

  it('clears the error and pushes the architecture again once the file is fixed', async () => {
    writeArchitect(tmpRoot, good)
    await daemonOn(tmpRoot)

    writeArchitect(tmpRoot, broken)
    await settle()
    expect(daemon.projects()[0]?.parseError).toBeDefined()

    const changes: Architecture[] = []
    daemon.onChange((a) => changes.push(a))

    writeArchitect(tmpRoot, good.replace('- api -> db', '- api -> db\n- db -> db'))
    await settle()

    expect(daemon.projects()[0]?.parseError).toBeUndefined()
    expect(changes.at(-1)?.edges).toContainEqual({ from: 'db', to: 'db' })
  })

  it('never answers allowed from a stale contract', async () => {
    writeArchitect(tmpRoot, good)
    await daemonOn(tmpRoot)
    writeArchitect(tmpRoot, broken)
    await settle()

    const c = await client(socketPath)
    const res = await c.request({ op: 'check_change', cwd: tmpRoot, from: 'api', to: 'db' })

    expect(res.ok).toBe(true)
    if (res.ok) {
      const verdict = res.result as Verdict
      expect(verdict.status).toBe('unknown')
      if (verdict.status === 'unknown') {
        expect(verdict.reason).toContain(`malformed dependency on line ${badLine}`)
        expect(verdict.reason).toMatch(/stale/i)
        expect(verdict.reason).toMatch(/allowed verdict/)
      }
    }
    c.close()
  })

  it('keeps a forbidden verdict forbidden and says the contract is stale', async () => {
    writeArchitect(tmpRoot, good)
    await daemonOn(tmpRoot)
    writeArchitect(tmpRoot, broken)
    await settle()

    const c = await client(socketPath)
    const res = await c.request({ op: 'check_change', cwd: tmpRoot, from: 'db', to: 'api' })

    expect(res.ok).toBe(true)
    if (res.ok) {
      const verdict = res.result as Verdict
      expect(verdict.status).toBe('forbidden')
      if (verdict.status === 'forbidden') {
        expect(verdict.reason).toContain('layers only point down')
        expect(verdict.reason).toMatch(/stale/i)
      }
    }
    c.close()
  })

  it('refuses every agent call when the file never parsed', async () => {
    writeArchitect(tmpRoot, broken)
    await daemonOn(tmpRoot)

    expect(await daemon.open(tmpRoot)).toBeNull()
    expect(daemon.projects()).toEqual([
      { root: tmpRoot, title: path.basename(tmpRoot), parseError: expect.stringContaining(`line ${badLine}`) },
    ])

    const c = await client(socketPath)
    const architecture = await c.request({ op: 'get_architecture', cwd: tmpRoot })
    const changed = await c.request({ op: 'check_change', cwd: tmpRoot, from: 'api', to: 'db' })

    expect(architecture.ok).toBe(false)
    if (!architecture.ok) expect(architecture.error).toContain(`line ${badLine}`)
    expect(changed.ok).toBe(false)
    if (!changed.ok) expect(changed.error).toContain(`line ${badLine}`)
    c.close()
  })

  it('reports a deleted architect.md and keeps the last good architecture', async () => {
    writeArchitect(tmpRoot, good)
    await daemonOn(tmpRoot)

    fs.rmSync(path.join(tmpRoot, 'architect.md'))
    await settle()

    expect(daemon.projects()[0]?.parseError).toMatch(/could not read .*architect\.md/)

    writeArchitect(tmpRoot, good)
    await settle()
    expect(daemon.projects()[0]?.parseError).toBeUndefined()
  })

  it('survives rapid successive bad saves and reports the last one', async () => {
    writeArchitect(tmpRoot, good)
    await daemonOn(tmpRoot)

    for (const bad of ['<<<<<<< HEAD', '- api ->', '- api -> ghost']) {
      writeArchitect(tmpRoot, good.replace('- api -> db', bad))
    }
    await settle()

    expect(daemon.projects()[0]?.parseError).toContain('unknown component in dependency: ghost')
  })

  it('marks only the broken project when two are open', async () => {
    const other = fs.mkdtempSync(path.join(tmpRoot, 'other-'))
    writeArchitect(tmpRoot, good)
    writeArchitect(other, good)
    await daemonOn(tmpRoot)
    await daemon.open(other)

    writeArchitect(tmpRoot, broken)
    await settle()

    const byRoot = Object.fromEntries(daemon.projects().map((p) => [p.root, p.parseError]))
    expect(byRoot[tmpRoot]).toContain(`line ${badLine}`)
    expect(byRoot[other]).toBeUndefined()

    expect(await daemon.open(other)).not.toBeNull()
    expect((await daemon.open(tmpRoot))?.edges).toEqual([{ from: 'api', to: 'db' }])
    expect(daemon.projects().find((p) => p.root === tmpRoot)?.parseError).toContain(`line ${badLine}`)

    writeArchitect(tmpRoot, good)
    await settle()
    expect(daemon.projects().find((p) => p.root === tmpRoot)?.parseError).toBeUndefined()
  })

  it('refuses to approve a proposal against a broken file', async () => {
    writeArchitect(tmpRoot, good)
    await daemonOn(tmpRoot)
    const c = await client(socketPath)

    const proposed = c.request({
      op: 'propose_change',
      cwd: tmpRoot,
      proposal: { kind: 'edge', from: 'db', to: 'db' },
      rationale: 'wiring',
    })
    await settle()

    writeArchitect(tmpRoot, broken)
    await settle()

    await daemon.decide(daemon.pending()[0]!.id, true)
    const res = await proposed

    expect(res.ok).toBe(true)
    if (res.ok) {
      const decision = res.result as Decision
      expect(decision.status).toBe('rejected')
      if (decision.status === 'rejected') expect(decision.reason).toContain(`line ${badLine}`)
    }
    expect(fs.readFileSync(path.join(tmpRoot, 'architect.md'), 'utf8')).toBe(broken)
    c.close()
  })
})

describe('source watcher', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  function pushes() {
    const seen: { root: string; files: string[] }[] = []
    daemon.onCodeMap((root, map) => {
      seen.push({ root, files: map.folders.flatMap((folder) => folder.files.map((file) => file.path)) })
    })
    return seen
  }

  async function watching(root: string, rescanDebounceMs = 60) {
    writeArchitect(root, fixture(component('api')))
    daemon = createDaemon({ socketPath, proposalTimeoutMs: 60_000, rescanDebounceMs })
    await daemon.listen()
    await daemon.open(root)
    await pause(200)
  }

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalKey
  })

  it('pushes a code map holding a source file written after the project opened', async () => {
    await watching(tmpRoot)
    const seen = pushes()

    fs.writeFileSync(path.join(tmpRoot, 'a.ts'), 'export function a() {}\n')
    await pause(900)

    expect(seen).toHaveLength(1)
    expect(seen[0]?.root).toBe(tmpRoot)
    expect(seen[0]?.files).toContain('a.ts')
  })

  it('collapses a burst of writes into a single rescan', async () => {
    await watching(tmpRoot)
    const seen = pushes()

    for (let at = 0; at < 40; at += 1) {
      fs.writeFileSync(path.join(tmpRoot, `f${at}.ts`), `export function f${at}() {}\n`)
    }
    await pause(1200)

    expect(seen).toHaveLength(1)
    expect(seen[0]?.files).toContain('f39.ts')
  })

  it('does not rescan for writes inside ignored directories', async () => {
    await watching(tmpRoot)
    const seen = pushes()

    for (const dir of ['node_modules', '.git', 'dist', 'out']) {
      fs.mkdirSync(path.join(tmpRoot, dir, 'deep'), { recursive: true })
      fs.writeFileSync(path.join(tmpRoot, dir, 'deep', 'noise.ts'), 'export function noise() {}\n')
    }
    await pause(900)

    expect(seen).toEqual([])
  })

  it('does not rescan for the map it writes into .architect', async () => {
    await watching(tmpRoot)
    fs.writeFileSync(path.join(tmpRoot, 'a.ts'), 'export function a() {}\n')
    await pause(900)

    const seen = pushes()
    await pause(900)

    expect(seen).toEqual([])
  })

  it('still produces a map when a changed file is deleted before the rescan reads it', async () => {
    await watching(tmpRoot, 400)
    const seen = pushes()

    fs.writeFileSync(path.join(tmpRoot, 'keep.ts'), 'export function keep() {}\n')
    const gone = path.join(tmpRoot, 'gone.ts')
    fs.writeFileSync(gone, 'export function gone() {}\n')
    await pause(150)
    fs.rmSync(gone)
    await pause(1500)

    expect(seen.at(-1)?.files).toContain('keep.ts')
    expect(seen.at(-1)?.files).not.toContain('gone.ts')
  })

  it('stops watching a project that is closed', async () => {
    await watching(tmpRoot)
    const seen = pushes()

    daemon.closeProject(tmpRoot)
    expect(daemon.projects()).toEqual([])

    fs.writeFileSync(path.join(tmpRoot, 'after.ts'), 'export function after() {}\n')
    await pause(900)

    expect(seen).toEqual([])
  })

  it('drops a pending debounced rescan when the project closes inside the window', async () => {
    await watching(tmpRoot)
    const seen = pushes()

    fs.writeFileSync(path.join(tmpRoot, 'racing.ts'), 'export function racing() {}\n')
    await pause(30)
    daemon.closeProject(tmpRoot)
    await pause(900)

    expect(seen).toEqual([])
  })

  it('watches a project again after it is closed and reopened', async () => {
    await watching(tmpRoot)
    daemon.closeProject(tmpRoot)
    await daemon.open(tmpRoot)
    await pause(200)

    const seen = pushes()
    fs.writeFileSync(path.join(tmpRoot, 'again.ts'), 'export function again() {}\n')
    await pause(900)

    expect(seen).toHaveLength(1)
    expect(seen[0]?.files).toContain('again.ts')
  })
})
