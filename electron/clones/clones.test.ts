import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scan } from '../scan/scan'
import { sameBehavior } from '.'
import { forgetJev } from './forget'
import { LEAST } from './near'
import { behaviorMarkdown } from './render'

const roots: string[] = []

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop() as string, { recursive: true, force: true })
})

function project(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clones-'))
  roots.push(root)
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text)
  }
  return root
}

const FILES = {
  'src/model/picker.ts': "export function plural(count: number, noun: string): string {\n  return `${count} ${noun}${count === 1 ? '' : 's'}`\n}\n",
  'src/view/CodeCanvas.tsx': "function plural(n: number, one: string) {\n  // the noun gets an s\n  return `${n} ${one}${n === 1 ? '' : 's'}`\n}\n",
  'src/view/functions/Mark.tsx': "export function plural(count: number, word: string): string {\n  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`\n}\n",
  'cli/text/report.ts': "function plural(count: number, word: string): string {\n  return `${count} ${word}${count === 1 ? '' : 's'}`\n}\n",
  'electron/evidence/index.ts': "const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`\n",
  'src/view/map/facts.ts': "const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`\n",
  'electron/contract/infer.ts': "export function inferText(n: number) {\n  const plural = (k: number) => (k === 1 ? 'file' : 'files')\n  return plural(n)\n}\n",
  'electron/daemon.ts': 'function errorText(err: unknown): string {\n  return err instanceof Error ? err.message : String(err)\n}\n',
  'electron/scan/cache.ts': "function errorText(err: unknown): string {\n  return err instanceof Error ? err.message : String(err)\n}\n\nfunction canonicalRoot(root: string): string {\n  const resolved = path.resolve(root)\n  try {\n    return fs.realpathSync.native(resolved)\n  } catch {\n    return resolved\n  }\n}\n",
  'src/model/store.ts': 'function errorText(err: unknown): string {\n  return err instanceof Error ? err.message : String(err)\n}\n',
  'electron/jev/index.ts': 'const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))\n',
  'electron/jev/match/render.ts': 'const percent = (value: number) => `${Math.round(value * 100)}%`\n',
  'src/view/coupling/Pair.tsx': 'const percent = (value: number) => `${Math.round(value * 100)}%`\n',
  'src/view/jev/SameBehavior.tsx': 'const percent = (share: number) => `${Math.round(share * 100)}%`\n',
  'electron/where/home.ts': "const counted = (side: Side) => side.ref.status === 'function' || side.ref.status === 'file'\n",
  'electron/where/similar.ts': "export function similarOf(refs: Resolved[]) {\n  const counted = (ref: Resolved) => ref.status === 'function' || ref.status === 'file'\n  return refs.filter(counted)\n}\n",
  'electron/where/index.ts': "const counted = (ref: Resolved) => ref.status === 'function' || ref.status === 'file'\n",
  'electron/where/refs.ts': 'function real(target: string): string {\n  const rest: string[] = []\n  let dir = target\n  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) {\n    rest.unshift(path.basename(dir))\n    dir = path.dirname(dir)\n  }\n  try {\n    return path.join(fs.realpathSync.native(dir), ...rest)\n  } catch {\n    return target\n  }\n}\n',
  'electron/rules/proposed.ts': 'function onDisk(file: string): string {\n  const left: string[] = []\n  let at = file\n  while (!fs.existsSync(at) && path.dirname(at) !== at) {\n    left.unshift(path.basename(at))\n    at = path.dirname(at)\n  }\n  try {\n    return path.join(fs.realpathSync.native(at), ...left)\n  } catch {\n    return file\n  }\n}\n\nfunction readText(file: string): string | undefined {\n  try {\n    return fs.readFileSync(file, \'utf8\')\n  } catch {\n    return undefined\n  }\n}\n',
  'electron/review/index.ts': 'function real(target: string): string {\n  try {\n    return fs.realpathSync.native(target)\n  } catch {\n    const parent = path.dirname(target)\n    return parent === target ? target : path.join(real(parent), path.basename(target))\n  }\n}\n',
  'electron/git/title.ts': 'function real(target: string): string {\n  try {\n    return fs.realpathSync.native(target)\n  } catch {\n    return target\n  }\n}\n',
  'electron/app/launch.ts': 'function realOf(target: string): string {\n  try {\n    return fs.realpathSync.native(target)\n  } catch {\n    return target\n  }\n}\n',
  'electron/agents/write.ts': "function readText(path: string): string | undefined {\n  try {\n    return fs.readFileSync(path, 'utf8')\n  } catch {\n    return undefined\n  }\n}\n",
  'electron/preload.ts': "const open = (root: string) => invoke('architect:open', root)\nconst close = (root: string) => invoke('architect:close', root)\n",
  'electron/where/where.test.ts': "function errorText(err: unknown): string {\n  return err instanceof Error ? err.message : String(err)\n}\n",
}

async function search(file: string, symbol: string, files: Record<string, string> = FILES) {
  const root = project(files)
  const found = sameBehavior(root, await scan(root), file, symbol)
  if (found.status !== 'done') throw new Error(found.reason)
  return found
}

const clones = (found: Awaited<ReturnType<typeof search>>) => found.matches.filter((match) => match.clone !== null).map((match) => [match.file, match.clone])

describe('sameBehavior', () => {
  it('groups every plural copy as an exact clone under renaming, and the one that adds a call as a near clone', async () => {
    const found = await search('src/model/picker.ts', 'plural')
    expect(clones(found)).toEqual([
      ['cli/text/report.ts', 'exact'],
      ['electron/evidence/index.ts', 'exact'],
      ['src/view/CodeCanvas.tsx', 'exact'],
      ['src/view/map/facts.ts', 'exact'],
      ['src/view/functions/Mark.tsx', 'near'],
    ])
    expect(found.matches.find((match) => match.file === 'src/view/functions/Mark.tsx')?.similarity).toBeGreaterThan(0.9)
  })

  it('treats an arrow with an expression body like a function returning it, and skips test files', async () => {
    expect(clones(await search('electron/daemon.ts', 'errorText'))).toEqual([
      ['electron/jev/index.ts', 'exact'],
      ['electron/scan/cache.ts', 'exact'],
      ['src/model/store.ts', 'exact'],
    ])
    expect(clones(await search('src/view/coupling/Pair.tsx', 'percent'))).toEqual([
      ['electron/jev/match/render.ts', 'exact'],
      ['src/view/jev/SameBehavior.tsx', 'exact'],
    ])
  })

  it('finds a nested copy and a copy that reads one more property', async () => {
    const found = await search('electron/where/index.ts', 'counted')
    expect(clones(found)).toEqual([
      ['electron/where/similar.ts', 'exact'],
      ['electron/where/home.ts', 'near'],
    ])
  })

  it('finds the realpath fallbacks and read helpers that do the same thing, and not the ones that do something else', async () => {
    expect(clones(await search('electron/git/title.ts', 'real'))).toEqual([['electron/app/launch.ts', 'exact']])
    expect(clones(await search('electron/where/refs.ts', 'real'))).toEqual([['electron/rules/proposed.ts', 'exact']])
    expect(clones(await search('electron/agents/write.ts', 'readText'))).toEqual([['electron/rules/proposed.ts', 'exact']])
  })

  it('does not call a different job a clone, and says when a body is too short to compare', async () => {
    expect(clones(await search('electron/review/index.ts', 'real'))).toEqual([])
    const short = await search('electron/preload.ts', 'open')
    expect(short.tokens).toBeLessThan(LEAST)
    expect(clones(short)).toEqual([])
    expect(behaviorMarkdown(short)).toContain(`under the ${LEAST} needed to compare it`)
  })

  it('marks structural matches and renders each match with its kind', async () => {
    const files = {
      'a.ts': "import { load } from './c'\nexport function one(id: string) {\n  return load(id)\n}\n",
      'b.ts': "import { load } from './c'\nexport function two(key: string) {\n  return load(key).trim()\n}\n",
      'c.ts': 'export function load(id: string) {\n  return id\n}\n',
    }
    const found = await search('a.ts', 'one', files)
    expect(found.matches.map((match) => [match.name, match.clone, match.structural])).toEqual([['two', null, true]])
    expect(behaviorMarkdown(found)).toContain('- `two` at b.ts:2, structural match only')
  })

  it('reads a changed file again and explains an unknown file or name', async () => {
    const root = project(FILES)
    expect(sameBehavior(root, await scan(root), 'nope.ts', 'x')).toEqual({ status: 'unknown', reason: 'nope.ts has no functions in the scan' })
    expect(sameBehavior(root, await scan(root), 'electron/git/title.ts', 'nope')).toMatchObject({ status: 'unknown', reason: expect.stringContaining('has no function named nope; it has real') })
    fs.writeFileSync(path.join(root, 'electron/app/launch.ts'), 'function realOf(target: string): string {\n  return target.trim().toLowerCase().normalize()\n}\n')
    const after = sameBehavior(root, await scan(root), 'electron/git/title.ts', 'real')
    expect(after.status === 'done' && after.matches.some((match) => match.file === 'electron/app/launch.ts')).toBe(false)
  })
})

describe('forgetJev', () => {
  it('deletes the old Jev folder with its sealed key, caches and usage, leaves the rest of userData, and does nothing when it is gone', () => {
    const userData = project({})
    for (const file of ['jev/key.bin', 'jev/index/abc.jsonl', 'jev/pairs/abc.jsonl', 'jev/usage/abc.json', 'jev/usage/month.json', 'settings.json']) {
      fs.mkdirSync(path.dirname(path.join(userData, file)), { recursive: true })
      fs.writeFileSync(path.join(userData, file), 'x')
    }
    forgetJev(userData)
    expect(fs.existsSync(path.join(userData, 'jev'))).toBe(false)
    expect(fs.readdirSync(userData)).toEqual(['settings.json'])
    expect(() => forgetJev(userData)).not.toThrow()
    expect(() => forgetJev(path.join(os.tmpdir(), 'clones-no-such-user-data'))).not.toThrow()
  })
})
