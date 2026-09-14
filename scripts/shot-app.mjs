import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron } from 'playwright'

const out = process.argv[2] ?? 'shot-app.png'

// discover
const dist = path.resolve(import.meta.dirname, '..', 'dist')
const binary = (fs.existsSync(dist) ? fs.readdirSync(dist) : [])
  .map((entry) => path.join(dist, entry, 'Architect.app', 'Contents', 'MacOS', 'Architect'))
  .find((candidate) => fs.existsSync(candidate))

if (!binary) {
  console.error('no packaged Architect.app under dist, run `npm run install:local` first')
  process.exit(1)
}

// seed
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-shot-'))
const source = path.join(os.homedir(), '.architect', 'projects.json')
let roots = []
try {
  const parsed = JSON.parse(fs.readFileSync(source, 'utf8'))
  if (Array.isArray(parsed)) roots = parsed
} catch {}

if (roots.length) fs.writeFileSync(path.join(tmp, 'projects.json'), JSON.stringify(roots, null, 2))
else console.log(`no projects restored from ${source}, capturing an empty project list`)

const errors = []
let app = null

try {
  app = await _electron.launch({
    executablePath: binary,
    env: { ...process.env, ARCHITECT_SOCKET: path.join(tmp, 'sock') }
  })
  app.process().stderr?.on('data', (chunk) => errors.push(`main: ${String(chunk).trimEnd()}`))

  const page = await app.firstWindow()
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.waitForSelector('.react-flow__node, .empty-state', { timeout: 30000 })
  await page.waitForTimeout(700)
  await page.screenshot({ path: out })

  console.log(`wrote ${out} for ${roots.length} project(s)`)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
} finally {
  if (errors.length) console.log('errors:\n' + errors.join('\n'))
  await app?.close().catch(() => {})
  fs.rmSync(tmp, { recursive: true, force: true })
}

process.exit(process.exitCode ?? 0)
