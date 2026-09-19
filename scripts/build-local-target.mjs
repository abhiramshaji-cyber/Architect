// build-local-target: run electron-builder with the target install:local needs.
// macOS keeps using --dir (the mac installer consumes the unpacked .app);
// Linux/Windows build real artifacts (.AppImage / nsis .exe) so install-local.mjs
// can actually find them.
import { execFileSync } from 'node:child_process'

const argsByPlatform = {
  darwin: ['--dir'],
  linux: ['--linux', 'AppImage'],
  win32: ['--win', 'nsis']
}

const args = argsByPlatform[process.platform]
if (!args) {
  console.error(`install:local does not support platform "${process.platform}"`)
  process.exit(1)
}

// on Windows the electron-builder entry point is a .cmd shim, which
// execFileSync can only launch through a shell
execFileSync('electron-builder', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
