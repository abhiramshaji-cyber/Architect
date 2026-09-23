import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server, type Socket } from 'node:net'
import { unlinkSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import type { Request, Proposal } from '../shared/types.js'
import {
  send,
  disconnect,
  getArchitecture,
  checkChange,
  proposeChange,
  awaitProposal,
  listEdits,
  getEdit,
} from './bridge.js'

function socketPath() {
  return `/tmp/a${randomBytes(4).toString('hex')}.sock`
}

function startServer(handleConnection: (socket: Socket) => void) {
  const path = socketPath()
  const server = createServer(handleConnection)
  server.listen(path)
  return { server, path }
}

function stopServer(server: Server, path: string) {
  server.close()
  try {
    unlinkSync(path)
  } catch {}
}

function readRequests(socket: Socket, onRequest: (req: Request, socket: Socket) => void) {
  let buffer = ''
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    let index: number
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (line) onRequest(JSON.parse(line), socket)
    }
  })
}

function startServerWithNoise(noise: string) {
  return startServer((socket) => {
    readRequests(socket, (req, s) => {
      s.write(noise)
      s.write(JSON.stringify({ id: req.id, ok: true, result: 'survived' }) + '\n')
    })
  })
}

describe('bridge', () => {
  afterEach(() => {
    disconnect()
  })

  it('sends a request and resolves the matching response', async () => {
    const { server, path } = startServer((socket) => {
      readRequests(socket, (req, s) => {
        s.write(JSON.stringify({ id: req.id, ok: true, result: { title: 'demo' } }) + '\n')
      })
    })

    const result = await send({ op: 'get_architecture' }, path)
    expect(result).toEqual({ title: 'demo' })

    stopServer(server, path)
  })

  it('tags every request with process.cwd()', async () => {
    let seenCwd = ''
    const { server, path } = startServer((socket) => {
      readRequests(socket, (req, s) => {
        seenCwd = req.cwd
        s.write(JSON.stringify({ id: req.id, ok: true, result: null }) + '\n')
      })
    })

    await send({ op: 'get_architecture' }, path)
    expect(seenCwd).toBe(process.cwd())

    stopServer(server, path)
  })

  it('parses a response split across two TCP chunks', async () => {
    const { server, path } = startServer((socket) => {
      readRequests(socket, (req, s) => {
        const line = JSON.stringify({ id: req.id, ok: true, result: { chunked: true } }) + '\n'
        const mid = Math.floor(line.length / 2)
        s.write(line.slice(0, mid))
        setTimeout(() => s.write(line.slice(mid)), 5)
      })
    })

    const result = await send({ op: 'get_architecture' }, path)
    expect(result).toEqual({ chunked: true })

    stopServer(server, path)
  })

  it('delivers two responses arriving in one chunk to the right callers, out of order', async () => {
    const requests: Request[] = []
    const { server, path } = startServer((socket) => {
      readRequests(socket, (req, s) => {
        requests.push(req)
        if (requests.length === 2) {
          const [first, second] = requests as [Request, Request]
          const lineForSecond = JSON.stringify({ id: second.id, ok: true, result: 'second' }) + '\n'
          const lineForFirst = JSON.stringify({ id: first.id, ok: true, result: 'first' }) + '\n'
          s.write(lineForSecond + lineForFirst)
        }
      })
    })

    const firstCall = send({ op: 'check_change', from: 'a', to: 'b' }, path)
    const secondCall = send({ op: 'get_architecture' }, path)

    const [firstResult, secondResult] = await Promise.all([firstCall, secondCall])
    expect(firstResult).toBe('first')
    expect(secondResult).toBe('second')

    stopServer(server, path)
  })

  it('returns a clear instruction when the daemon is not running', async () => {
    const path = socketPath()

    await expect(send({ op: 'get_architecture' }, path)).rejects.toThrow(/architect/i)
  })

  it('rejects when the daemon never answers', async () => {
    const { server, path } = startServer(() => {})

    await expect(send({ op: 'get_architecture' }, path, 50)).rejects.toThrow(/did not respond/i)

    stopServer(server, path)
  })

  it('rejects an in-flight call when the socket drops', async () => {
    const { server, path } = startServer((socket) => {
      readRequests(socket, () => {
        socket.destroy()
      })
    })

    await expect(send({ op: 'get_architecture' }, path)).rejects.toThrow()

    stopServer(server, path)
  })

  it('maps get_architecture to op get_architecture', async () => {
    let seenOp = ''
    const { server, path } = startServer((socket) => {
      readRequests(socket, (req, s) => {
        seenOp = req.op
        s.write(JSON.stringify({ id: req.id, ok: true, result: 'ok' }) + '\n')
      })
    })

    const result = await getArchitecture(path)
    expect(seenOp).toBe('get_architecture')
    expect(result).toEqual({ content: [{ type: 'text', text: '"ok"' }] })

    stopServer(server, path)
  })

  it('maps check_change to op check_change with from and to', async () => {
    let seenReq: Request | undefined
    const { server, path } = startServer((socket) => {
      readRequests(socket, (req, s) => {
        seenReq = req
        s.write(JSON.stringify({ id: req.id, ok: true, result: { status: 'allowed' } }) + '\n')
      })
    })

    await checkChange('a', 'b', path)
    expect(seenReq).toMatchObject({ op: 'check_change', from: 'a', to: 'b' })

    stopServer(server, path)
  })

  it('maps propose_change to op propose_change with proposal and rationale', async () => {
    let seenReq: Request | undefined
    const { server, path } = startServer((socket) => {
      readRequests(socket, (req, s) => {
        seenReq = req
        s.write(JSON.stringify({ id: req.id, ok: true, result: { status: 'approved' } }) + '\n')
      })
    })

    const proposal: Proposal = { kind: 'component', id: 'x', purpose: 'p', owns: ['o'] }
    await proposeChange(proposal, 'because', path)
    expect(seenReq).toMatchObject({ op: 'propose_change', proposal, rationale: 'because' })

    stopServer(server, path)
  })

  it('maps await_proposal to op await_proposal with proposalId', async () => {
    let seenReq: Request | undefined
    const { server, path } = startServer((socket) => {
      readRequests(socket, (req, s) => {
        seenReq = req
        s.write(JSON.stringify({ id: req.id, ok: true, result: { status: 'approved' } }) + '\n')
      })
    })

    await awaitProposal('p1', path)
    expect(seenReq).toMatchObject({ op: 'await_proposal', proposalId: 'p1' })

    stopServer(server, path)
  })

  it('maps list_edits to op list_edits and returns the daemon listing', async () => {
    let seenReq: Request | undefined
    const listing = [{ id: '0abc-12345678', status: 'handed', title: 'Drafted' }]
    const { server, path } = startServer((socket) => {
      readRequests(socket, (req, s) => {
        seenReq = req
        s.write(JSON.stringify({ id: req.id, ok: true, result: listing }) + '\n')
      })
    })

    const result = await listEdits(path)
    expect(seenReq).toMatchObject({ op: 'list_edits' })
    expect(JSON.parse(result.content[0].text)).toEqual(listing)

    stopServer(server, path)
  })

  it('maps get_edit to op get_edit with editId', async () => {
    let seenReq: Request | undefined
    const { server, path } = startServer((socket) => {
      readRequests(socket, (req, s) => {
        seenReq = req
        s.write(JSON.stringify({ id: req.id, ok: true, result: { id: 'e1', status: 'handed' } }) + '\n')
      })
    })

    await getEdit('e1', path)
    expect(seenReq).toMatchObject({ op: 'get_edit', editId: 'e1' })

    stopServer(server, path)
  })

  it('returns tool error content, not a throw, when the daemon is down', async () => {
    const path = socketPath()

    const result = await getArchitecture(path)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/architect/i)
  })

  it('surfaces a daemon-reported error as tool error content', async () => {
    const { server, path } = startServer((socket) => {
      readRequests(socket, (req, s) => {
        s.write(JSON.stringify({ id: req.id, ok: false, error: 'forbidden dependency' }) + '\n')
      })
    })

    const result = await checkChange('a', 'b', path)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe('forbidden dependency')

    stopServer(server, path)
  })
  it('survives a truncated line and still delivers the response', async () => {
    const { server, path } = startServerWithNoise('{"id":"abc","ok":true,"resu\n')

    expect(await send({ op: 'get_architecture' }, path)).toBe('survived')

    stopServer(server, path)
  })

  it('survives a line that is not JSON at all', async () => {
    const { server, path } = startServerWithNoise('not json\n')

    expect(await send({ op: 'get_architecture' }, path)).toBe('survived')

    stopServer(server, path)
  })

  it('survives valid JSON that is not a response', async () => {
    const { server, path } = startServerWithNoise('null\n7\n"hello"\n[1,2]\ntrue\n{"nope":1}\n{"id":42}\n')

    expect(await send({ op: 'get_architecture' }, path)).toBe('survived')

    stopServer(server, path)
  })

  it('survives empty and whitespace-only lines', async () => {
    const { server, path } = startServerWithNoise('\n\n   \n\t\n')

    expect(await send({ op: 'get_architecture' }, path)).toBe('survived')

    stopServer(server, path)
  })

  it('survives a very long malformed line', async () => {
    const { server, path } = startServerWithNoise(`${'x'.repeat(2_000_000)}\n`)

    expect(await send({ op: 'get_architecture' }, path)).toBe('survived')

    stopServer(server, path)
  })

  it('keeps serving later calls after a malformed line', async () => {
    let calls = 0
    const { server, path } = startServer((socket) => {
      readRequests(socket, (req, s) => {
        calls += 1
        if (calls === 1) s.write('}{ broken\n')
        s.write(JSON.stringify({ id: req.id, ok: true, result: calls }) + '\n')
      })
    })

    expect(await send({ op: 'get_architecture' }, path)).toBe(1)
    expect(await send({ op: 'get_architecture' }, path)).toBe(2)

    stopServer(server, path)
  })

  it('rejects rather than hangs when a reply carries a known id but no verdict', async () => {
    const { server, path } = startServer((socket) => {
      readRequests(socket, (req, s) => {
        s.write(JSON.stringify({ id: req.id, result: 'ambiguous' }) + '\n')
      })
    })

    await expect(send({ op: 'get_architecture' }, path, 5_000)).rejects.toThrow(/not a result or an error/i)

    stopServer(server, path)
  })

  it('rejects an in-flight call when disconnect() is called', async () => {
    const { server, path } = startServer(() => {})

    const call = send({ op: 'get_architecture' }, path, 5_000)
    await new Promise((resolve) => setTimeout(resolve, 20))
    disconnect()

    await expect(call).rejects.toThrow(/connection closed/i)

    stopServer(server, path)
  })
  it('parses a response split inside a multibyte character', async () => {
    const { server, path } = startServer((socket) => {
      readRequests(socket, (req, s) => {
        const line = Buffer.from(JSON.stringify({ id: req.id, ok: true, result: 'caf\u00e9 \u2705' }) + '\n', 'utf8')
        const cut = line.indexOf(Buffer.from('\u2705', 'utf8')) + 1
        s.write(line.subarray(0, cut))
        setTimeout(() => s.write(line.subarray(cut)), 5)
      })
    })

    expect(await send({ op: 'get_architecture' }, path)).toBe('caf\u00e9 \u2705')

    stopServer(server, path)
  })
})
