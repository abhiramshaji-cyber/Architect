import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { CodeMap, FunctionEntry } from '../../shared/types'
import type { ChangeSet, FileChange, Hunk } from '../git/churn'
import { scan } from '../scan/scan'
import { traceBack } from './trace'
import { churnOf, tally } from '.'

const hunk = (oldStart: number, oldCount: number, newStart: number, newCount: number): Hunk => ({ oldStart, oldCount, newStart, newCount })

describe('traceBack', () => {
  const back = (from: number, to: number, hunks: Hunk[]) => traceBack({ from, to }, hunks)

  it('moves a range past lines added or removed above it and leaves it alone for changes below', () => {
    expect(back(6, 9, [hunk(1, 0, 2, 3)])).toEqual({ touched: false, parent: { from: 3, to: 6 } })
    expect(back(2, 4, [hunk(1, 2, 0, 0)])).toEqual({ touched: false, parent: { from: 4, to: 6 } })
    expect(back(4, 6, [hunk(8, 0, 9, 3)])).toEqual({ touched: false, parent: { from: 4, to: 6 } })
  })

  it('is touched by lines added or replaced inside it and widens to the lines they replaced', () => {
    expect(back(2, 9, [hunk(4, 2, 4, 5)])).toEqual({ touched: true, parent: { from: 2, to: 6 } })
    expect(back(4, 6, [hunk(3, 5, 3, 3)])).toEqual({ touched: true, parent: { from: 2, to: 8 } })
  })

  it('is not touched by lines added right at its edges', () => {
    expect(back(2, 4, [hunk(4, 0, 5, 2)])).toEqual({ touched: false, parent: { from: 2, to: 4 } })
    expect(back(6, 8, [hunk(4, 0, 5, 2)])).toEqual({ touched: false, parent: { from: 4, to: 6 } })
  })

  it('is touched by a deletion only when it holds the lines on both sides of it', () => {
    expect(back(2, 6, [hunk(5, 2, 4, 0)])).toEqual({ touched: true, parent: { from: 2, to: 8 } })
    expect(back(4, 6, [hunk(5, 2, 4, 0)])).toEqual({ touched: false, parent: { from: 6, to: 8 } })
    expect(back(2, 4, [hunk(5, 2, 4, 0)])).toEqual({ touched: false, parent: { from: 2, to: 4 } })
  })

  it('has no parent range when every line in it was added by this change', () => {
    expect(back(2, 4, [hunk(2, 0, 3, 2)])).toEqual({ touched: true, parent: null })
  })

  it('applies several hunks of one change together', () => {
    expect(back(10, 12, [hunk(1, 0, 2, 2), hunk(5, 1, 7, 0)])).toEqual({ touched: false, parent: { from: 9, to: 11 } })
  })
})

const fn = (name: string, line: number, endLine: number): FunctionEntry => ({ name, line, endLine, description: '', calls: [] })

const map = (files: Record<string, FunctionEntry[]>): CodeMap => ({
  root: '/r',
  scannedAt: 1,
  folders: [{ path: '', folders: [], files: Object.entries(files).map(([path, functions]) => ({ path, functions })) }],
})

const change = (path: string, hunks: Hunk[] | null, extra: Partial<FileChange> = {}): FileChange => ({
  path,
  added: 1,
  removed: 1,
  binary: false,
  created: false,
  deleted: false,
  hunks,
  ...extra,
})

const set = (...files: FileChange[]): ChangeSet => ({ sha: 's', at: 1, files })

describe('tally', () => {
  const code = map({ 'a.ts': [fn('one', 1, 3), fn('two', 5, 7)] })

  it('counts commits and lines per file and the functions each hunk lands in', () => {
    const churn = tally({ complete: true, working: null, commits: [set(change('a.ts', [hunk(6, 1, 6, 1)])), set(change('a.ts', [hunk(2, 0, 3, 1)], { added: 4, removed: 0 }))] }, code, 90)

    expect(churn.files).toEqual({ 'a.ts': { commits: 2, added: 5, removed: 1 } })
    expect(churn.functions).toEqual({ 'a.ts:5:two': 1, 'a.ts:1:one': 1 })
  })

  it('counts a deletion only when the function holds the lines on both sides of it, as git log -L does', () => {
    const commits = [set(change('f.ts', [hunk(4, 0, 5, 1)])), set(change('f.ts', [hunk(5, 1, 4, 0)]))]
    const spans = (ranges: [number, number][]) => map({ 'f.ts': ranges.map(([line, end], i) => fn(`f${i}`, line, end)) })
    const churn = tally({ complete: true, working: null, commits }, spans([[4, 5], [5, 6], [4, 6], [1, 4]]), 90)

    expect(churn.functions).toEqual({ 'f.ts:4:f0': 1, 'f.ts:5:f1': 1, 'f.ts:4:f2': 2 })
  })

  it('counts a deletion inside a function but not one just past its end', () => {
    const inside = tally({ complete: true, working: null, commits: [set(change('a.ts', [hunk(3, 1, 2, 0)]))] }, code, 90)
    const after = tally({ complete: true, working: null, commits: [set(change('a.ts', [hunk(4, 1, 3, 0)]))] }, code, 90)

    expect(inside.functions).toEqual({ 'a.ts:1:one': 1 })
    expect(after.functions).toEqual({})
  })

  it('never credits a file creation with functions inserted after it', () => {
    const commits = [set(change('a.ts', [hunk(3, 0, 4, 4)])), set(change('a.ts', [hunk(0, 0, 1, 3)], { created: true }))]

    expect(tally({ complete: true, working: null, commits }, code, 90).functions).toEqual({ 'a.ts:1:one': 1, 'a.ts:5:two': 1 })
  })

  it('carries an older hunk through newer changes and uncommitted edits before matching', () => {
    const working = set(change('a.ts', [hunk(0, 0, 1, 2)]))
    const commits = [set(change('a.ts', [hunk(0, 0, 1, 2)])), set(change('a.ts', [hunk(1, 1, 1, 1)]))]

    expect(tally({ complete: true, working, commits }, code, 90).functions).toEqual({ 'a.ts:1:one': 1, 'a.ts:5:two': 1 })
    expect(tally({ complete: true, working, commits }, code, 90).files['a.ts']?.commits).toBe(2)
  })

  it('follows a rename so the old name keeps counting for the new one', () => {
    const commits = [set(change('a.ts', [], { from: 'old.ts', added: 0, removed: 0 })), set(change('old.ts', [hunk(2, 1, 2, 1)]))]
    const churn = tally({ complete: true, working: null, commits }, code, 90)

    expect(churn.files).toEqual({ 'a.ts': { commits: 2, added: 1, removed: 1 } })
    expect(churn.functions).toEqual({ 'a.ts:1:one': 1 })
  })

  it('follows a rename that is not committed yet', () => {
    const working = set(change('a.ts', [], { from: 'old.ts', added: 0, removed: 0 }))
    const churn = tally({ complete: true, working, commits: [set(change('old.ts', [hunk(6, 1, 6, 1)]))] }, code, 90)

    expect(churn.files).toEqual({ 'a.ts': { commits: 1, added: 1, removed: 1 } })
    expect(churn.functions).toEqual({ 'a.ts:5:two': 1 })
  })

  it('never gives a file the history of an older file that had its name', () => {
    const commits = [set(change('a.ts', [hunk(0, 0, 1, 7)], { created: true })), set(change('a.ts', null, { deleted: true })), set(change('a.ts', [hunk(1, 1, 1, 1)]))]
    const churn = tally({ complete: true, working: null, commits }, code, 90)

    expect(churn.files['a.ts']?.commits).toBe(1)
    expect(churn.functions).toEqual({ 'a.ts:1:one': 1, 'a.ts:5:two': 1 })
  })

  it('leaves out files deleted since, including ones deleted but not committed', () => {
    const working = set(change('b.ts', null, { deleted: true }))
    const commits = [set(change('c.ts', [], { deleted: true })), set(change('b.ts', [hunk(1, 1, 1, 1)]), change('c.ts', [hunk(1, 1, 1, 1)]))]

    expect(tally({ complete: true, working, commits }, code, 90).files).toEqual({})
  })

  it('stops placing older hunks on functions once a change cannot be read, but keeps counting the file', () => {
    const commits = [set(change('a.ts', null)), set(change('a.ts', [hunk(2, 1, 2, 1)]))]
    const churn = tally({ complete: true, working: null, commits }, code, 90)

    expect(churn.files['a.ts']?.commits).toBe(2)
    expect(churn.functions).toEqual({})
  })

  it('says when the history it was given is incomplete', () => {
    expect(tally({ complete: false, working: null, commits: [] }, code, 90)).toEqual({ days: 90, files: {}, functions: {}, incomplete: true })
    expect(tally({ complete: true, working: null, commits: [] }, code, 90)).toEqual({ days: 90, files: {}, functions: {} })
  })

  it('marks a binary file and never places its changes on functions', () => {
    const churn = tally({ complete: true, working: null, commits: [set(change('a.ts', [], { binary: true, added: 0, removed: 0 }))] }, code, 90)

    expect(churn.files).toEqual({ 'a.ts': { commits: 1, added: 0, removed: 0, binary: true } })
    expect(churn.functions).toEqual({})
  })
})

describe('churnOf', () => {
  const dirs: string[] = []
  afterAll(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })))
  const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

  function repo(): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'architect-churnof-')))
    dirs.push(dir)
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'config', 'user.email', 't@t')
    git(dir, 'config', 'user.name', 't')
    return dir
  }

  const save = (dir: string, file: string, lines: string[], message?: string) => {
    fs.writeFileSync(path.join(dir, file), `${lines.join('\n')}\n`)
    if (!message) return
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', message)
  }

  it('returns empty churn for a repo with no commits', async () => {
    const dir = repo()
    save(dir, 'a.ts', ['export function a() {}'])
    expect(await churnOf(dir, await scan(dir))).toEqual({ days: 90, files: {}, functions: {} })
  })

  it('counts commits per file and per function across edits, a shift and a rename', async () => {
    const dir = repo()
    const one = ['export function one() {', '  return 1', '}']
    const two = ['export function two() {', '  return 2', '}']
    save(dir, 'a.ts', [...one, '', ...two], 'create')
    save(dir, 'a.ts', [...one, '', two[0]!, '  return 22', two[2]!], 'edit two')
    save(dir, 'a.ts', ['// a', '// b', '', ...one, '', two[0]!, '  return 22', two[2]!], 'shift')
    git(dir, 'mv', 'a.ts', 'b.ts')
    save(dir, 'b.ts', ['// a', '// b', '', one[0]!, '  return 11', one[2]!, '', two[0]!, '  return 22', two[2]!], 'rename and edit one')
    save(dir, 'b.ts', ['// a', '// b', '', one[0]!, '  return 11', one[2]!, '', two[0]!, '  return 222', two[2]!])

    const churn = await churnOf(dir, await scan(dir), 30)
    const numstat = git(dir, 'log', '--numstat', '--format=', '--', '.').trim().split('\n').filter(Boolean)
    const total = numstat.reduce((sum, line) => sum + Number(line.split('\t')[0]) + Number(line.split('\t')[1]), 0)

    expect(churn.days).toBe(30)
    expect(churn.files).toEqual({ 'b.ts': { commits: 4, added: expect.any(Number), removed: expect.any(Number) } })
    expect((churn.files['b.ts']?.added ?? 0) + (churn.files['b.ts']?.removed ?? 0)).toBe(total)
    expect(churn.functions).toEqual({ 'b.ts:4:one': 2, 'b.ts:8:two': 2 })
  })

  it('never credits an old deletion to lines a later commit inserted where it was', async () => {
    const dir = repo()
    save(dir, 'f.ts', ['A', 'B', 'C'], 'abc')
    save(dir, 'f.ts', ['A', 'B'], 'drop c')
    save(dir, 'f.ts', ['A', 'B', 'X', 'Y'], 'add x y')
    save(dir, 'f.ts', ['A', 'Y'], 'drop b x')
    const code = map({ 'f.ts': [fn('y', 2, 2)] })
    const log = git(dir, 'log', '--first-parent', '-L2,2:f.ts', '--format=%x1e', '--no-patch')

    expect((await churnOf(dir, code)).functions).toEqual({ 'f.ts:2:y': log.split('\x1e').length - 1 })
    expect((await churnOf(dir, code)).functions).toEqual({ 'f.ts:2:y': 1 })
  })

  it('keeps counting functions through a commit that turns a file into a symlink', async () => {
    const dir = repo()
    const src = ['export function a() {', '  return 1', '}', '', 'export function b() {', '  return 2', '}']
    save(dir, 'link.txt', ['plain'])
    save(dir, 'x.ts', src, 'one')
    fs.rmSync(path.join(dir, 'link.txt'))
    fs.symlinkSync('x.ts', path.join(dir, 'link.txt'))
    save(dir, 'x.ts', src.map((line) => line.replace('return 2', 'return 3')), 'two')

    const churn = await churnOf(dir, await scan(dir), 30)
    expect(churn.functions).toEqual({ 'x.ts:1:a': 1, 'x.ts:5:b': 2 })
    expect(churn.incomplete).toBeUndefined()
  })

  it.each([[0], [-5], [Number.NaN], ['30'], [undefined]])('falls back to 90 days for %j', async (days) => {
    expect((await churnOf(repo(), map({}), days)).days).toBe(90)
  })
})
