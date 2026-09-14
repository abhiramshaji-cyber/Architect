import net from 'node:net'

const socketPath = process.env.ARCHITECT_SOCKET ?? `${process.env.HOME}/.architect/sock`
const sock = net.createConnection(socketPath)
const waiting = new Map()
let buffer = ''

sock.on('data', chunk => {
  buffer += chunk
  let i
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i)
    buffer = buffer.slice(i + 1)
    if (!line.trim()) continue
    const res = JSON.parse(line)
    waiting.get(res.id)?.(res)
    waiting.delete(res.id)
  }
})

const call = req =>
  new Promise(resolve => {
    const id = Math.random().toString(36).slice(2)
    waiting.set(id, resolve)
    sock.write(JSON.stringify({ ...req, id, cwd: process.cwd() }) + '\n')
  })

await new Promise(r => sock.once('connect', r))

const res = await call({
  op: 'propose_change',
  proposal: { kind: 'edge', from: 'canvas', to: 'bridge' },
  rationale: 'demo: the canvas wants to talk to the mcp bridge directly'
})

console.log('decision:', JSON.stringify(res.result ?? res.error))
sock.end()
process.exit(0)
