import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Decision, Request, Response } from '../shared/types'
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
  let buf = ''
  socket.on('data', (chunk) => {
    buf += chunk.toString()
    let idx: number
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (!line) continue
      const res = JSON.parse(line) as Response
      waiters.get(res.id)?.(res)
      waiters.delete(res.id)
    }
  })

  return {
    socket,
    request(req: RequestInput): Promise<Response> {
      return new Promise((resolve) => {
        const id = randomUUID()
        waiters.set(id, resolve)
        socket.write(`${JSON.stringify({ ...req, id } as Request)}\n`)
      })
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
