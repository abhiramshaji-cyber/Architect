import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const NAME = 'Architect.app'

const isDir = (p) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

const isFile = (p) => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function distEntries() {
  try {
    return readdirSync('dist')
  } catch {
    return []
  }
}

function installMac() {
  const roots = distEntries().filter((d) => d.startsWith('mac') && isDir(join('dist', d)))
  const built = roots.map((d) => join('dist', d, NAME)).find(isDir)

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

  const target = join('/Applications', NAME)
  rmSync(target, { recursive: true, force: true })
  cpSync(built, target, { recursive: true, verbatimSymlinks: true })
  execFileSync('open', ['-a', target])
  console.log(`installed ${built} -> ${target}`)
}

function installLinux() {
  const appImage = distEntries()
    .filter((f) => f.endsWith('.AppImage'))
    .map((f) => join('dist', f))
    .find(isFile)

  if (!appImage) {
    console.error('no AppImage found under dist/. Build one with: npm run build && electron-builder --linux AppImage')
    process.exit(1)
  }

  const appDir = join(homedir(), '.local', 'share', 'architect')
  const binDir = join(homedir(), '.local', 'bin')
  mkdirSync(appDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })

  const target = join(appDir, 'Architect.AppImage')
  cpSync(appImage, target)
  chmodSync(target, 0o755)

  const link = join(binDir, 'architect')
  rmSync(link, { force: true })
  cpSync(target, link)
  chmodSync(link, 0o755)

  console.log(`installed ${appImage} -> ${target}`)
  console.log(`run it with: architect (ensure ${binDir} is on your PATH)`)
}

function installWindows() {
  const installer = distEntries()
    .filter((f) => f.endsWith('.exe'))
    .map((f) => join('dist', f))
    .find(isFile)

  if (!installer) {
    console.error('no installer (.exe) found under dist/. Build one with: npm run build && electron-builder --win nsis')
    process.exit(1)
  }

  console.log(`installer ready: ${installer}`)
  console.log('run it to install Architect (double-click, or: start "" "<path>")')
}

function installBridge() {
  // unpack-bridge
  if (!existsSync('out/mcp/bridge.js')) return
  const binDir = join(homedir(), '.architect', 'bin')
  const bridge = join(binDir, 'architect-mcp.mjs')
  mkdirSync(binDir, { recursive: true })
  cpSync('out/mcp/bridge.js', bridge)
  chmodSync(bridge, 0o755)
  console.log(`installed mcp bridge -> ${bridge}`)
}

if (process.platform === 'darwin') installMac()
else if (process.platform === 'linux') installLinux()
else if (process.platform === 'win32') installWindows()
else {
  console.error(`install:local does not support platform "${process.platform}"`)
  process.exit(1)
}

installBridge()
