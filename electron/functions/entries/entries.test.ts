import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { entriesIn } from './index'
import { declaredIn } from './manifest'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function entriesOf(files: Record<string, string>): Record<string, string[]> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-entries-'))
  roots.push(root)
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  const manifest = files['package.json'] === undefined ? null : JSON.parse(files['package.json'])
  return Object.fromEntries(entriesIn(root, new Set(Object.keys(files)), manifest))
}

const lib = (dir: string, entry: string, name?: string) =>
  `import { resolve } from 'node:path'\nimport { defineConfig } from 'vite'\nexport default defineConfig({ build: { outDir: '${dir}', lib: { entry: resolve('${entry}')${name ? `, fileName: () => '${name}'` : ''} } } })\n`

describe('entriesIn', () => {
  it('maps built outputs in package.json back to their sources through the build configs', () => {
    expect(
      entriesOf({
        'package.json': JSON.stringify({
          main: 'out/main/main.js',
          bin: { app: 'out/cli/main.js', mcp: 'out/mcp/bridge.js', gone: 'out/none/x.js' },
        }),
        'electron.vite.config.ts': [
          "import { resolve } from 'node:path'",
          'export default defineConfig({',
          "  main: { build: { lib: { entry: resolve('electron/main.ts') } } },",
          "  preload: { build: { lib: { entry: resolve(__dirname, 'electron/preload.ts') } } },",
          "  renderer: { root: 'src', build: { rollupOptions: { input: resolve('src/index.html') } } },",
          '})',
        ].join('\n'),
        'vite.cli.config.ts': lib('out/cli', 'cli/main.ts'),
        'vite.mcp.config.ts': lib('out/mcp', 'mcp/bridge.ts', 'bridge.js'),
        'src/index.html': '<html><script type="module" src="./main.tsx"></script><script src="https://cdn.x/y.js"></script></html>',
        'electron/main.ts': '',
        'electron/preload.ts': '',
        'src/main.tsx': '',
        'cli/main.ts': '',
        'mcp/bridge.ts': '',
      }),
    ).toEqual({
      'electron/main.ts': ['electronMain', 'main'],
      'electron/preload.ts': ['preload'],
      'src/main.tsx': ['renderer'],
      'cli/main.ts': ['bin'],
      'mcp/bridge.ts': ['bin'],
    })
  })

  it('falls back to the electron-vite default layout', () => {
    expect(
      entriesOf({
        'electron.vite.config.mjs': 'export default {}\n',
        'src/main/index.ts': '',
        'src/preload/index.js': '',
        'src/renderer/index.html': '<script type="module" src="/src/app.ts"></script>',
        'src/renderer/src/app.ts': '',
      }),
    ).toEqual({
      'src/main/index.ts': ['electronMain'],
      'src/preload/index.js': ['preload'],
      'src/renderer/src/app.ts': ['renderer'],
    })
  })

  it('reads the page scripts of a plain vite app and a multi page input', () => {
    expect(entriesOf({ 'vite.config.ts': 'export default defineConfig(() => ({}))\n', 'index.html': '<script type="module" src="/src/main.ts"></script>', 'src/main.ts': '' })).toEqual({
      'src/main.ts': ['page'],
    })
    expect(
      entriesOf({
        'vite.config.js': "const config = { build: { rollupOptions: { input: { a: 'a.html', b: 'b/index.html' } } } }\nmodule.exports = config\n",
        'a.html': '<script src="a.js"></script>',
        'b/index.html': '<script src="./b.js"></script>',
        'a.js': '',
        'b/b.js': '',
      }),
    ).toEqual({ 'a.js': ['page'], 'b/b.js': ['page'] })
  })

  it('maps a compiled main through tsconfig outDir and rootDir, or the common source folder', () => {
    const files = { 'package.json': JSON.stringify({ main: './dist/index.js', bin: 'dist/cli.mjs' }), 'src/index.ts': '', 'src/cli.mts': '' }
    expect(entriesOf({ ...files, 'tsconfig.json': '{ "compilerOptions": { "outDir": "dist", "rootDir": "src" } }' })).toEqual({
      'src/index.ts': ['main'],
      'src/cli.mts': ['bin'],
    })
    expect(entriesOf({ ...files, 'tsconfig.json': '{ // comment\n "compilerOptions": { "outDir": "./dist" }, "include": ["src"] }' })).toEqual({
      'src/index.ts': ['main'],
      'src/cli.mts': ['bin'],
    })
  })

  it('takes a source path in package.json as is and survives broken configs', () => {
    expect(
      entriesOf({
        'package.json': JSON.stringify({ main: 'index.js', bin: { x: './bin/x.js' } }),
        'vite.config.ts': 'export default defineConfig(',
        'tsconfig.json': '{ nope',
        'index.js': '',
        'bin/x.js': '',
      }),
    ).toEqual({ 'index.js': ['main'], 'bin/x.js': ['bin'] })
    expect(entriesOf({})).toEqual({})
  })
})

describe('declaredIn', () => {
  it('reads main and every bin, dropping a leading ./ and anything outside the package', () => {
    expect(declaredIn({ main: './src/index.ts', bin: { a: 'cli/a.js', b: './cli/b.js', c: '../up.js' } })).toEqual([
      { reason: 'main', file: 'src/index.ts' },
      { reason: 'bin', file: 'cli/a.js' },
      { reason: 'bin', file: 'cli/b.js' },
    ])
    expect(declaredIn({ bin: 'run.js' })).toEqual([{ reason: 'bin', file: 'run.js' }])
  })

  it('ignores a missing or malformed manifest', () => {
    expect(declaredIn(null)).toEqual([])
    expect(declaredIn('nope')).toEqual([])
    expect(declaredIn({ main: 3, bin: [null, '', '.'] })).toEqual([])
  })
})
