import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { _electron } from 'playwright'

const USAGE =
  'usage: node scripts/shot-app.mjs --repo <path> --view <functions|flow|map|code|layers|hotspots|coupling> [--mode list|tree|focus] [--target <name or file:line>] [--depth N] [--lens importance|churn|touched|unreached|style] [--zoom <folder>] [--folder <path>] [--select <file>] --out <png>'
const LABELS = { functions: 'Functions', flow: 'Flow', map: 'Map', code: 'Code', layers: 'Layers', hotspots: 'Hotspots', coupling: 'Coupling' }
const LENSES = ['importance', 'churn', 'touched', 'unreached', 'style']
const WINDOW_DAYS = 90
const quote = (value) => JSON.stringify(String(value))
const trimmed = (folder) => (folder ?? '').replace(/^\.?\/+|\/+$/g, '')

let opts
try {
  const options = Object.fromEntries(['repo', 'view', 'mode', 'target', 'depth', 'lens', 'zoom', 'folder', 'select', 'out'].map((name) => [name, { type: 'string' }]))
  opts = parseArgs({ options, strict: true }).values
} catch (err) {
  console.error(`${err.message}\n${USAGE}`)
  process.exit(2)
}

function checked() {
  if (!opts.repo || !opts.out || !LABELS[opts.view]) throw new Error(USAGE)
  const root = fs.realpathSync.native(path.resolve(opts.repo))
  if (!fs.statSync(root).isDirectory()) throw new Error(`${root} is not a folder`)
  const mode = opts.mode ?? (opts.target ? 'focus' : 'list')
  if (!['list', 'tree', 'focus'].includes(mode)) throw new Error(`--mode must be list, tree or focus\n${USAGE}`)
  const lens = opts.lens ?? 'importance'
  if (!LENSES.includes(lens)) throw new Error(`--lens must be one of ${LENSES.join(', ')}`)
  const depth = Number(opts.depth ?? 3)
  if (!Number.isInteger(depth) || depth < 1 || depth > 64) throw new Error('--depth must be a whole number from 1 to 64')
  if (opts.view === 'flow' && !opts.target) throw new Error('--view flow needs --target, a starting point')
  return { root, mode, lens, depth }
}

function git(root, ...args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    throw new Error(`git ${args.join(' ')} failed in ${root}: ${String(err.stderr ?? err.message).trim()}`)
  }
}

function historyReady(root, view, lens) {
  if (!['hotspots', 'coupling'].includes(view) && !(view === 'map' && lens === 'churn')) return
  if (git(root, 'rev-parse', '--is-shallow-repository') === 'true') throw new Error(`${root} is a shallow clone, so ${view} would undercount its history; run git fetch --unshallow first`)
  if (git(root, 'rev-list', '--count', `--since=${WINDOW_DAYS}.days`, 'HEAD') === '0') throw new Error(`${root} has no commits in the last ${WINDOW_DAYS} days, so the churn window is empty`)
}

function pickRow(rows, target, flow) {
  const at = /^(.+):(\d+)$/.exec(target)
  const found = rows.filter((row) => (at ? row.file === at[1] && row.line === Number(at[2]) : row.name === target))
  if (found.length === 0) throw new Error(`no function ${target} in the scan; pass a name or file:line from the Functions list`)
  if (found.length > 1) throw new Error(`${target} is ambiguous, pass one of: ${found.map((row) => `${row.file}:${row.line}`).join(', ')}`)
  if (flow && !found[0].entry) throw new Error(`${target} has no starting point reason, and Flow only draws from a starting point`)
  return found[0]
}

function codeFiles(root) {
  const folder = trimmed(opts.folder ?? (opts.select?.includes('/') ? path.posix.dirname(opts.select) : ''))
  const kind = (relative) => fs.statSync(path.join(root, relative), { throwIfNoEntry: false })
  if (!kind(folder)?.isDirectory()) throw new Error(`--folder ${folder} is not a folder in ${root}`)
  if (!opts.select) return { folder, file: null }
  const file = [path.posix.join(folder, opts.select), opts.select].find((each) => kind(each)?.isFile())
  if (!file) throw new Error(`--select ${opts.select} is not a file in ${folder || 'the repo root'}`)
  return { folder, file }
}

function plan({ root, mode, lens, depth }, rows) {
  const slot = (view, part) => `architect.${view}.${part}:${root}`
  const keyOf = (row) => `${row.file}\0${row.line}\0${row.name}`
  const seed = { theme: 'light' }

  if (opts.view === 'functions') {
    const row = opts.target ? pickRow(rows, opts.target, false) : null
    seed[slot('functions', 'mode')] = mode
    if (row) seed[slot('functions', 'focus')] = keyOf(row)
    const focused = row ? `.fn-tree.focus[data-focus=${quote(`${row.file}:${row.line}`)}]` : '.fn-tree.focus[data-focus]'
    const wait = { list: '.fn-row', tree: '.fn-tree .react-flow__node', focus: focused }[mode]
    return { seed, wait, shot: { list: '.fn-list', tree: '.fn-tree', focus: '.fn-tree.focus' }[mode] }
  }
  if (opts.view === 'flow') {
    const row = pickRow(rows, opts.target, true)
    Object.assign(seed, { [slot('flow', 'start')]: keyOf(row), [slot('flow', 'depth')]: String(depth) })
    return { seed, wait: `.flow-body[data-start=${quote(`${row.file}:${row.line}`)}][data-depth=${quote(depth)}]`, shot: 'section.flow' }
  }
  if (opts.view === 'map') {
    const zoom = trimmed(opts.zoom)
    seed[slot('map', 'lens')] = lens
    if (zoom) seed[slot('map', 'zoom')] = `folder\0${zoom}`
    const wait = `section.map[data-lens=${quote(lens)}][data-zoom=${quote(zoom)}] .map-body`
    return { seed, wait, shot: 'section.map', landed: { found: 'section.map[data-zoom]', attr: 'data-zoom' } }
  }
  if (opts.view === 'code') {
    const { folder, file } = codeFiles(root)
    seed[slot('code', 'folder')] = folder
    if (file) seed[slot('code', 'selected')] = `codefile:${file}`
    const stage = file ? `.canvas-stage[data-selected=${quote(`codefile:${file}`)}]` : '.canvas-stage'
    return { seed, wait: `.code-bar[data-folder=${quote(folder)}] ~ ${stage}`, shot: '.canvas-stage', landed: { found: '.code-bar[data-folder]', attr: 'data-folder' } }
  }
  const wait = { layers: '.layers-body, section.layers .fn-empty', hotspots: '.hs-plot', coupling: '.cp-list, section.coupling .fn-empty' }[opts.view]
  return { seed, wait, shot: `section.${opts.view}` }
}

function binary() {
  const dist = path.resolve(import.meta.dirname, '..', 'dist')
  const found = (fs.existsSync(dist) ? fs.readdirSync(dist) : [])
    .map((entry) => path.join(dist, entry, 'Architect.app', 'Contents', 'MacOS', 'Architect'))
    .find((candidate) => fs.existsSync(candidate))
  if (!found) throw new Error('no packaged Architect.app under dist; run `npm run build && npm exec -- node scripts/build-local-target.mjs`, never install:local, which replaces the installed app, ~/.architect/bin and the Claude hooks')
  return found
}

async function waitFor(page, view, selector, landed) {
  try {
    await page.waitForSelector(selector, { timeout: 90_000 })
  } catch {
    const notice = await page.locator('.fn-notice').first().textContent({ timeout: 500 }).catch(() => null)
    const at = landed ? await page.locator(landed.found).first().getAttribute(landed.attr, { timeout: 500 }).catch(() => null) : null
    throw new Error(`${view} never showed ${selector}${at === null ? '' : `; it landed on ${landed.attr}=${quote(at)}`}${notice ? `; the view says: ${notice}` : ''}`)
  }
}

async function capture(app, args, out) {
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1600, 1000))
  const tabs = page.locator('.pane-bar nav.cyber-tabs button.cyber-tab')
  await tabs.first().waitFor({ timeout: 60_000 })

  // resolve
  const list = await page.evaluate((root) => window.architect.listFunctions(root, ''), args.root)
  if (list.rows.length === 0) throw new Error(`the scan found 0 functions in ${args.root}; Architect reads TypeScript and JavaScript`)
  const step = plan(args, list.rows)

  // seed
  await page.evaluate((seed) => Object.entries(seed).forEach(([key, value]) => localStorage.setItem(key, value)), step.seed)
  await page.reload()
  await tabs.first().waitFor({ timeout: 60_000 })
  const theme = await page.evaluate(() => document.documentElement.dataset.theme)
  if (theme !== 'light') throw new Error(`the app came up in ${theme} mode, not light`)

  // land
  await tabs.filter({ hasText: new RegExp(`^${LABELS[opts.view]}$`) }).click()
  await waitFor(page, opts.view, step.wait, step.landed)
  await page.addStyleTag({ content: '.canvas-header, .map-trail > span:first-child, .map-trail > span:nth-child(2) > .map-sep { display: none !important }' })
  await page.waitForTimeout(1200)
  await page.locator(step.shot).first().screenshot({ path: out })
}

const sockets = fs.mkdtempSync('/tmp/ash-')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-shot-'))
const socket = path.join(sockets, 'sock')
const errors = []
let app = null

try {
  if (Buffer.byteLength(socket) >= 100) throw new Error(`socket path ${socket} is too long for macOS`)
  const args = checked()
  historyReady(args.root, opts.view, args.lens)
  app = await _electron.launch({
    executablePath: binary(),
    args: [args.root, `--user-data-dir=${userData}`],
    env: { ...process.env, ARCHITECT_SOCKET: socket },
  })
  app.process().stderr?.on('data', (chunk) => errors.push(`main: ${String(chunk).trimEnd()}`))
  app.on('window', (page) => page.on('pageerror', (e) => errors.push(String(e))))
  await capture(app, args, path.resolve(opts.out))
  console.log(`wrote ${opts.out}`)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
} finally {
  if (errors.length) console.log('errors:\n' + errors.join('\n'))
  await app?.close().catch(() => {})
  fs.rmSync(sockets, { recursive: true, force: true })
  fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

process.exit(process.exitCode ?? 0)
