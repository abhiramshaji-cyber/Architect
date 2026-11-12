import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CallSite, CodeMap } from '../../shared/types'
import { scan } from './scan'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function mapOf(files: Record<string, string>): Promise<CodeMap> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-sites-'))
  roots.push(root)
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  return scan(root)
}

function sitesOf(map: CodeMap, file: string, name: string): string[] {
  const all = map.folders.flatMap((folder) => folder.files)
  const label = (site: CallSite) =>
    'bridge' in site
      ? `bridge ${site.bridge}:${site.line}`
      : `${all.find((f) => f.path === site.file)?.functions[site.fn]?.name ?? '?'}:${site.line}`
  const fn = all.find((f) => f.path === file)?.functions.find((f) => f.name === name)
  return (fn?.sites ?? []).map(label)
}

describe('call sites in the scan', () => {
  it('keeps every call site in source order with its line, local and imported interleaved', async () => {
    const map = await mapOf({
      'b.ts': 'export function far() {}\nexport function near() {}\n',
      'a.ts': [
        "import { far, near } from './b'",
        'function local() {}',
        'export function run() {',
        '  near()',
        '  local()',
        '  far(local())',
        '  near()',
        '}',
      ].join('\n'),
    })
    expect(sitesOf(map, 'a.ts', 'run')).toEqual(['near:4', 'local:5', 'far:6', 'local:6', 'near:7'])
    const run = map.folders
      .flatMap((f) => f.files)
      .find((f) => f.path === 'a.ts')
      ?.functions.find((f) => f.name === 'run')
    expect(run?.calls).toHaveLength(3)
  })

  it('records a call through window.<bridge>.<member> only when window is the global', async () => {
    const map = await mapOf({
      'r.ts': [
        'export function load() {',
        '  window.api.read(1)',
        '  window.alert("x")',
        '}',
        'export function shadowed(window: any) {',
        '  window.api.read(2)',
        '}',
      ].join('\n'),
    })
    expect(sitesOf(map, 'r.ts', 'load')).toEqual(['bridge api.read:2'])
    expect(sitesOf(map, 'r.ts', 'shadowed')).toEqual([])
  })

  it('leaves sites off a function that calls nothing it can resolve', async () => {
    const map = await mapOf({ 'a.ts': 'export function idle() { console.log(1) }\n' })
    const idle = map.folders.flatMap((f) => f.files)[0]?.functions[0]
    expect(idle?.sites).toBeUndefined()
  })
})
