import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const APPS = '/Applications'
const NAME = 'Architect.app'

if (process.platform !== 'darwin') {
  console.error('install:local currently supports macOS only. On Windows run the installer in dist/.')
  process.exit(1)
}

const roots = readdirSync('dist').filter(d => d.startsWith('mac') && statSync(join('dist', d)).isDirectory())
const built = roots.map(d => join('dist', d, NAME)).find(p => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
})

if (!built) {
  console.error(`no built app found under dist/. looked in: ${roots.join(', ') || 'nothing'}`)
  process.exit(1)
}

try {
  execFileSync('pkill', ['-x', 'Architect'])
} catch {}

// await-exit
for (let i = 0; i < 50; i++) {
  try {
    execFileSync('pgrep', ['-x', 'Architect'], { stdio: 'ignore' })
    execFileSync('sleep', ['0.2'])
  } catch {
    break
  }
}

const target = join(APPS, NAME)
rmSync(target, { recursive: true, force: true })
cpSync(built, target, { recursive: true, verbatimSymlinks: true })

// unpack-bridge
const binDir = join(homedir(), '.architect', 'bin')
const bridge = join(binDir, 'architect-mcp.mjs')
mkdirSync(binDir, { recursive: true })
cpSync('out/mcp/bridge.js', bridge)
chmodSync(bridge, 0o755)

execFileSync('open', ['-a', target])
console.log(`installed ${built} -> ${target}`)
console.log(`installed mcp bridge -> ${bridge}`)
