import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CodeMap, StartKind } from '../../../shared/types'
import { scan } from '../scan'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function mapOf(files: Record<string, string>): Promise<CodeMap> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-starts-'))
  roots.push(root)
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  return scan(root)
}

function startsOf(map: CodeMap, file: string): Partial<Record<StartKind, string[]>> {
  const all = map.folders.flatMap((folder) => folder.files)
  const name = (ref: { file: string; fn: number }) =>
    `${ref.file}:${all.find((f) => f.path === ref.file)?.functions[ref.fn]?.name ?? '?'}`
  const entry = all.find((f) => f.path === file)
  const found: Partial<Record<StartKind, string[]>> = {}
  for (const start of entry?.starts ?? []) found[start.kind] = [...(found[start.kind] ?? []), ...start.calls.map(name)]
  return found
}

describe('starts in the scan', () => {
  it('records what load time code calls, passes as a callback or renders, across files', async () => {
    const map = await mapOf({
      'lib.ts': 'export function boot() {}\nexport function quit() {}\nexport const App = () => null\n',
      'main.tsx': [
        "import { boot, quit, App } from './lib'",
        'function local() {}',
        'function idle() {}',
        'boot()',
        "process.on('exit', quit)",
        'ready.then(() => local())',
        'render(<App />)',
      ].join('\n'),
    })
    expect(startsOf(map, 'main.tsx').load?.sort()).toEqual(['lib.ts:App', 'lib.ts:boot', 'lib.ts:quit', 'main.tsx:local'])
  })

  it('finds mcp tools through inline handlers, named handlers and the low level server', async () => {
    const map = await mapOf({
      'tools.ts': 'export function read() {}\nexport function write() {}\nexport function call() {}\n',
      'server.ts': [
        "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'",
        "import { read, write, call } from './tools'",
        'function main() {',
        "  const server = new McpServer({ name: 'x', version: '1' })",
        "  server.registerTool('read', {}, () => read())",
        "  server.tool('write', write)",
        '  server.setRequestHandler(CallToolRequestSchema, call)',
        '}',
        'main()',
      ].join('\n'),
      'other.ts': "import { read } from './tools'\nthing.tool('x', read)\n",
    })
    expect(startsOf(map, 'server.ts').mcpTool?.sort()).toEqual(['tools.ts:call', 'tools.ts:read', 'tools.ts:write'])
    expect(startsOf(map, 'other.ts').mcpTool).toBeUndefined()
  })

  it('finds ipc handlers registered directly and through wrappers two levels deep', async () => {
    const map = await mapOf({
      'git.ts': 'export function status() {}\nexport function push() {}\nexport function pull() {}\n',
      'ipc.ts': [
        "import { ipcMain, app } from 'electron'",
        "import * as git from './git'",
        "import { pull } from './git'",
        'function wrapIn(channel, fn) { ipcMain.handle(channel, async (event, ...args) => fn(event, ...args)) }',
        'const wrap = (channel, fn) => wrapIn(channel, (_e, ...args) => fn(...args))',
        'export function wire() {',
        "  ipcMain.on('pull', pull)",
        "  wrap('status', (root) => git.status(root))",
        "  wrapIn('push', (_e, root) => git.push(root))",
        "  app.on('quit', () => git.pull())",
        '}',
      ].join('\n'),
    })
    expect(startsOf(map, 'ipc.ts').ipcHandler?.sort()).toEqual(['git.ts:pull', 'git.ts:push', 'git.ts:status'])
  })

  it('finds every preload bridge member, nested, shorthand and spread', async () => {
    const map = await mapOf({
      'preload.ts': [
        "import { contextBridge } from 'electron'",
        'function ping() {}',
        'const extra = { more: () => 1 }',
        'const api = { open: () => 1, git: { push: () => 2 }, ping, ...extra, save() {} }',
        "contextBridge.exposeInMainWorld('api', api)",
        "contextBridge.exposeInMainWorld('inline', { close: () => 3 })",
      ].join('\n'),
    })
    expect(startsOf(map, 'preload.ts').bridge?.sort()).toEqual([
      'preload.ts:api.git.push',
      'preload.ts:api.open',
      'preload.ts:api.save',
      'preload.ts:close',
      'preload.ts:extra.more',
      'preload.ts:ping',
    ])
  })

  it('records the channel, line and ordered call sites of each ipc handler, through wrappers', async () => {
    const map = await mapOf({
      'git.ts': 'export function status() {}\nexport function push() {}\n',
      'ipc.ts': [
        "import { ipcMain } from 'electron'",
        "import { status, push } from './git'",
        'function wrapIn(channel, fn) { ipcMain.handle(channel, async (event, ...args) => fn(event, ...args)) }',
        'const wrap = (name, fn) => wrapIn(name, (_e, ...args) => fn(...args))',
        "wrap('git:both', () => { push(); status() })",
        "ipcMain.on('git:status', status)",
        'ipcMain.handle(`git:${1}`, push)',
      ].join('\n'),
    })
    const starts = map.folders.flatMap((f) => f.files).find((f) => f.path === 'ipc.ts')?.starts ?? []
    const routed = starts.filter((start) => start.channel !== undefined)
    expect(routed.map(({ channel, line, sites }) => ({ channel, line, sites: sites?.map((site) => ('fn' in site ? site.fn : -1)) }))).toEqual([
      { channel: 'git:both', line: 5, sites: [1, 0] },
      { channel: 'git:status', line: 6, sites: [0] },
    ])
  })

  it('names each bridge member by its window path and the channel it sends on', async () => {
    const map = await mapOf({
      'preload.ts': [
        "import { contextBridge, ipcRenderer } from 'electron'",
        'const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args)',
        'const api = {',
        "  read: (id) => call('api:read', id),",
        "  write: (id) => ipcRenderer.send('api:write', id),",
        "  watch: (fn) => ipcRenderer.on('api:changed', fn),",
        "  git: { push: () => call('api:push') },",
        '}',
        "contextBridge.exposeInMainWorld('api', api)",
        "contextBridge.exposeInMainWorld(name(), { lost: () => call('api:lost') })",
      ].join('\n'),
    })
    const starts = map.folders.flatMap((f) => f.files).find((f) => f.path === 'preload.ts')?.starts ?? []
    const members = starts.filter((start) => start.kind === 'bridge').map(({ member, channel }) => `${member ?? '?'} ${channel ?? '-'}`)
    expect(members.sort()).toEqual(['? api:lost', 'api.git.push api:push', 'api.read api:read', 'api.watch -', 'api.write api:write'])
  })

  it('finds cli commands from argv checks, switches, aliases and command libraries', async () => {
    const map = await mapOf({
      'cmds.ts': ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map((name) => `export function ${name}() {}`).join('\n'),
      'cli.ts': [
        "import { a, b, c, d, e, f, g, h, i, j, k, l } from './cmds'",
        "import { program, Command } from 'commander'",
        'function main() {}',
        "if (process.argv[2] === 'a') a()",
        'else main()',
        'const [cmd] = process.argv.slice(2)',
        "switch (cmd) { case 'b': b(); break; default: main() }",
        "program.command('c').description('x').action(c)",
        "yargs.command('d', 'desc', {}, () => d())",
        "yargs.command({ command: 'e', handler: e })",
        "if ('f' === process.argv[3] && ready) f()",
        "if (process.argv.length > 2) g()",
        "if (cmd === 'h' || cmd === 'hh') h()",
        "program.argument('<x>').action(i)",
        "const sub = program.command('j')",
        'sub.action(j)',
        "new Command().action(k)",
        "promise.action(g)",
        'const args = process.argv.slice(2)',
        'const rest = args.slice(1)',
        "if (rest[0] === 'l') l()",
      ].join('\n'),
    })
    expect(startsOf(map, 'cli.ts').cliCommand?.sort()).toEqual(
      ['a', 'b', 'c', 'd', 'e', 'f', 'h', 'i', 'j', 'k', 'l'].map((name) => `cmds.ts:${name}`),
    )
  })

  it('records the functions a barrel re-exports, by name and through stars', async () => {
    const map = await mapOf({
      'a.ts': 'export function one() {}\nfunction hidden() {}\n',
      'b.ts': 'export function two() {}\n',
      'c.ts': "export * from './b'\nexport function three() {}\n",
      'index.ts': "export { one } from './a'\nexport * from './c'\n",
    })
    expect(startsOf(map, 'index.ts').exports?.sort()).toEqual(['a.ts:one', 'b.ts:two', 'c.ts:three'])
  })

  it('records nothing for a file with no load time code and no registrations, nor for a test file', async () => {
    const map = await mapOf({
      'lib.ts': 'export function a() { b() }\nfunction b() {}\n',
      'lib.test.ts': "import { a } from './lib'\na()\nserver.registerTool('x', {}, a)\n",
    })
    expect(startsOf(map, 'lib.ts')).toEqual({})
    expect(startsOf(map, 'lib.test.ts')).toEqual({})
  })
})
