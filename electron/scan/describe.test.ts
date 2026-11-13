import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe as suite, expect, it, vi } from 'vitest'
import type { CodeMap } from '../../shared/types'
import type { AiOutput, AiRun } from '../ai'
import { describe } from './describe'

let root: string
let tag = 0

function write(file: string, content: string) {
  fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), content)
}

function fn(name: string, line: number) {
  return { name, line, endLine: line, description: '', calls: [] }
}

function map(): CodeMap {
  return {
    root,
    scannedAt: 1,
    folders: [
      { path: '', folders: ['src'], files: [{ path: 'a.ts', functions: [fn('alpha', 1)] }] },
      { path: 'src', folders: [], files: [{ path: 'src/b.ts', functions: [fn('beta', 1), fn('gamma', 5)] }] },
    ],
  }
}

function descriptions(result: CodeMap) {
  return result.folders.flatMap((f) => f.files.flatMap((file) => file.functions.map((one) => one.description)))
}

function says(code: AiOutput['code'], reply: (prompt: string) => Record<string, string> = () => ({})) {
  const prompts: string[] = []
  const run = vi.fn<AiRun>(async (prompt) => {
    prompts.push(prompt)
    return { code, stdout: JSON.stringify(reply(prompt)), stderr: '', cli: 'claude' }
  })
  return { run, prompts }
}

const every = (prompt: string) => Object.fromEntries([...prompt.matchAll(/key="(f\d+)" file="([^"]+)"/g)].map(([, key, file]) => [key, `${file} ${key}.`]))

async function filled(first: (done: () => void) => void) {
  await new Promise<void>((resolve) => first(resolve))
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'describe-'))
  tag++
  write('a.ts', `export function alpha() {\n  return ${tag}\n}`)
  write('src/b.ts', `export function beta() {\n  return ${tag}\n}\n\nexport function gamma() {\n  return ${tag}\n}`)
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

suite('describe', () => {
  it('never asks anyone without a run', () => {
    expect(descriptions(describe(map(), root).map)).toEqual(['', '', ''])
  })

  it('answers at once and writes the summaries in the background', async () => {
    const { run, prompts } = says(0, every)
    let first: CodeMap | null = null
    await filled((done) => (first = describe(map(), root, {}, run, done).map))

    expect(descriptions(first as unknown as CodeMap)).toEqual(['', '', ''])
    expect(run).toHaveBeenCalledTimes(1)
    expect(prompts[0]).toContain('file="a.ts"')
    expect(prompts[0]).toContain('file="src/b.ts"')

    const next = describe(map(), root, {}, run)
    expect(descriptions(next.map)).toEqual(['a.ts f1.', 'src/b.ts f2.', 'src/b.ts f3.'])
    expect(Object.keys(next.cache)).toHaveLength(3)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('splits more than forty functions across requests', async () => {
    write('many.ts', Array.from({ length: 45 }, (_, at) => `export function f${at}() { return ${tag} }`).join('\n'))
    const many: CodeMap = { root, scannedAt: 1, folders: [{ path: '', folders: [], files: [{ path: 'many.ts', functions: Array.from({ length: 45 }, (_, at) => fn(`f${at}`, at + 1)) }] }] }
    const { run } = says(0, every)
    await filled((done) => describe(many, root, {}, run, done))

    expect(run).toHaveBeenCalledTimes(2)
    expect(descriptions(describe(many, root, {}, run).map).every((text) => text !== '')).toBe(true)
  })

  it('keeps only the keys it asked about', async () => {
    const { run } = says(0, () => ({ f1: '  One.  ', f9: 'Stray.', f2: '' }))
    await filled((done) => describe(map(), root, {}, run, done))
    expect(descriptions(describe(map(), root, {}, run).map)).toEqual(['One.', '', ''])
  })

  it('takes a cached sentence over asking again', async () => {
    const { run } = says(0, every)
    await filled((done) => describe(map(), root, {}, run, done))
    const cache = Object.fromEntries(Object.keys(describe(map(), root, {}, run).cache).map((hash) => [hash, 'Cached.']))

    const again = says(0, every)
    expect(descriptions(describe(map(), root, cache, again.run).map)).toEqual(['Cached.', 'Cached.', 'Cached.'])
    expect(again.run).not.toHaveBeenCalled()
  })

  it('asks again on the next pass after a cli that is not connected or signed in', async () => {
    const off = says('not-connected')
    describe(map(), root, {}, off.run)
    await vi.waitFor(() => expect(off.run).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const on = says(0, every)
    await filled((done) => describe(map(), root, {}, on.run, done))
    expect(on.run).toHaveBeenCalledTimes(1)
  })

  it('backs off after a real failure instead of asking on every pass', async () => {
    const broken = says(1)
    describe(map(), root, {}, broken.run)
    await vi.waitFor(() => expect(broken.run).toHaveBeenCalledTimes(1))

    describe(map(), root, {}, broken.run)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(broken.run).toHaveBeenCalledTimes(1)
  })

  it('leaves out files it cannot read', async () => {
    fs.rmSync(path.join(root, 'a.ts'))
    const { run, prompts } = says(0, every)
    await filled((done) => describe(map(), root, {}, run, done))
    expect(prompts[0]).not.toContain('file="a.ts"')
  })

  it('forgets cache entries no longer in the map', async () => {
    const { run } = says(0, every)
    await filled((done) => describe(map(), root, {}, run, done))
    const shrunk = map()
    shrunk.folders = shrunk.folders.slice(0, 1)
    expect(Object.values(describe(shrunk, root, {}, run).cache)).toEqual(['a.ts f1.'])
  })
})
