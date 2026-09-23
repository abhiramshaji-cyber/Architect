import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { MAX_DIFF_BYTES, type ChangedFile, type DiffSection } from '../../shared/types'
import { changes, fileDiff, mergeBase, stageFile, unstageFile } from './diff'

const roots: string[] = []

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
}

function tmp(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `architect-${prefix}-`)))
  roots.push(root)
  return root
}

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' })
}

function write(root: string, file: string, body: string | Buffer): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), body)
}

function bare(): string {
  const remote = tmp('origin')
  sh(remote, 'init', '--bare', '-b', 'main', '.')
  return remote
}

function tracked(prefix = 'diff'): string {
  const root = tmp(prefix)
  sh(root, 'init', '-b', 'main', '.')
  write(root, 'a.txt', 'one\ntwo\nthree\nfour\nfive\n')
  sh(root, 'add', '-A')
  sh(root, 'commit', '-m', 'first')

  const remote = bare()
  sh(root, 'remote', 'add', 'origin', remote)
  sh(root, 'push', '-q', '-u', 'origin', 'main')
  sh(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')

  return root
}

function named(files: readonly ChangedFile[], file: string): ChangedFile {
  const found = files.find((entry) => entry.path === file)
  if (!found) throw new Error(`${file} not listed in ${files.map((entry) => entry.path).join(', ')}`)
  return found
}

async function section(root: string, id: DiffSection): Promise<ChangedFile[]> {
  const out = await changes(root)
  if (!out.ok) throw new Error(`changes failed: ${out.error.kind}`)
  const result = out.value[id]
  if (!result.ok) throw new Error(`${id} failed: ${result.error.kind}`)
  return result.value
}

async function hunksOf(root: string, id: DiffSection, file: ChangedFile, full = false) {
  const out = await fileDiff(root, id, file, full)
  if (!out.ok) throw new Error(`fileDiff failed: ${out.error.kind}`)
  return out.value
}

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
})

describe('changes', () => {
  it('keeps committed, staged and unstaged apart', async () => {
    const root = tracked()
    sh(root, 'checkout', '-q', '-b', 'work')
    write(root, 'committed.txt', 'c\n')
    sh(root, 'add', '-A')
    sh(root, 'commit', '-m', 'second')
    write(root, 'staged.txt', 's\n')
    sh(root, 'add', 'staged.txt')
    write(root, 'a.txt', 'one\nTWO\nthree\nfour\nfive\n')

    const out = await changes(root)

    expect(out.ok && out.value.branch.ok && out.value.branch.value.map((f) => f.path)).toEqual(['committed.txt'])
    expect(out.ok && out.value.staged.ok && out.value.staged.value.map((f) => f.path)).toEqual(['staged.txt'])
    expect(out.ok && out.value.unstaged.ok && out.value.unstaged.value.map((f) => f.path)).toEqual(['a.txt'])
  })

  it('carries added and removed counts per file', async () => {
    const root = tracked()
    write(root, 'a.txt', 'one\nTWO\nthree\nfour\nfive\nsix\n')

    expect(named(await section(root, 'unstaged'), 'a.txt')).toMatchObject({ status: 'modified', added: 2, removed: 1 })
  })

  it('reports a binary file as binary with no counts', async () => {
    const root = tracked()
    write(root, 'blob.bin', Buffer.from([0, 1, 2, 3, 0, 255]))
    sh(root, 'add', '-A')

    expect(named(await section(root, 'staged'), 'blob.bin')).toMatchObject({ binary: true, added: null, removed: null })
  })

  it('reports a rename as one renamed file, not a delete and an add', async () => {
    const root = tracked()
    sh(root, 'mv', 'a.txt', 'b.txt')

    const staged = await section(root, 'staged')

    expect(staged).toHaveLength(1)
    expect(staged[0]).toMatchObject({ path: 'b.txt', from: 'a.txt', status: 'renamed', similarity: 100 })
  })

  it('reports a copy as a copied file carrying its source', async () => {
    const root = tracked()
    write(root, 'a.txt', 'one\ntwo\nthree\nfour\nfive\nsix\n')
    write(root, 'copy.txt', 'one\ntwo\nthree\nfour\nfive\nsix\n')
    sh(root, 'add', '-A')

    expect(named(await section(root, 'staged'), 'copy.txt')).toMatchObject({ from: 'a.txt', status: 'copied' })
  })

  it('lists a deleted file', async () => {
    const root = tracked()
    fs.rmSync(path.join(root, 'a.txt'))

    expect(named(await section(root, 'unstaged'), 'a.txt')).toMatchObject({ status: 'deleted', added: 0, removed: 5 })
  })

  it('lists an untracked file in the unstaged section without counting it up front', async () => {
    const root = tracked()
    write(root, 'fresh.txt', 'x\ny\n')

    expect(named(await section(root, 'unstaged'), 'fresh.txt')).toMatchObject({
      status: 'untracked',
      from: null,
      added: null,
      removed: null,
    })
  })

  it('reads a path containing a space and a non ascii character', async () => {
    const root = tracked()
    write(root, 'a file ünicode.txt', 'hi\n')
    sh(root, 'add', '-A')

    expect(named(await section(root, 'staged'), 'a file ünicode.txt')).toMatchObject({ status: 'added', added: 1 })
  })

  it('surfaces ahead and behind from the branch header', async () => {
    const root = tracked()
    write(root, 'a.txt', 'one\ntwo\nthree\nfour\nfive\nsix\n')
    sh(root, 'add', '-A')
    sh(root, 'commit', '-m', 'ahead')

    const out = await changes(root)

    expect(out.ok && out.value.status).toMatchObject({ upstream: 'origin/main', ahead: 1, behind: 0 })
  })

  it('fails the branch section alone when there is no remote to base it on', async () => {
    const root = tmp('noremote')
    sh(root, 'init', '-b', 'main', '.')
    write(root, 'a.txt', 'one\n')
    sh(root, 'add', '-A')
    sh(root, 'commit', '-m', 'first')
    write(root, 'a.txt', 'two\n')

    const out = await changes(root)

    expect(out.ok && out.value.branch.ok).toBe(false)
    expect(out.ok && !out.value.branch.ok && out.value.branch.error.kind).toBe('no-remote')
    expect(out.ok && out.value.unstaged.ok && out.value.unstaged.value.map((f) => f.path)).toEqual(['a.txt'])
  })

  it('still lists staged files in a repo with no commits', async () => {
    const root = tmp('nocommits')
    sh(root, 'init', '-b', 'main', '.')
    write(root, 'a.txt', 'one\n')
    sh(root, 'add', '-A')

    const out = await changes(root)

    expect(out.ok && out.value.staged.ok && out.value.staged.value.map((f) => f.path)).toEqual(['a.txt'])
    expect(out.ok && !out.value.branch.ok && out.value.branch.error.kind).toBe('no-remote')
  })

  it('reads a detached HEAD against the same merge base', async () => {
    const root = tracked()
    sh(root, 'checkout', '-q', '--detach')
    write(root, 'a.txt', 'one\ntwo\nthree\nfour\nfive\nsix\n')
    sh(root, 'add', '-A')
    sh(root, 'commit', '-m', 'detached work')

    const out = await changes(root)

    expect(out.ok && out.value.status.head.kind).toBe('detached')
    expect(out.ok && out.value.branch.ok && out.value.branch.value.map((f) => f.path)).toEqual(['a.txt'])
  })
})

describe('mergeBase', () => {
  it('bases the branch diff on the fork point, not on the moved default branch', async () => {
    const root = tracked()
    const fork = sh(root, 'rev-parse', 'HEAD').trim()

    sh(root, 'checkout', '-q', '-b', 'work')
    write(root, 'mine.txt', 'mine\n')
    sh(root, 'add', '-A')
    sh(root, 'commit', '-m', 'mine')

    sh(root, 'checkout', '-q', 'main')
    write(root, 'theirs.txt', 'theirs\n')
    sh(root, 'add', '-A')
    sh(root, 'commit', '-m', 'theirs')
    sh(root, 'push', '-q', 'origin', 'main')
    sh(root, 'fetch', '-q', 'origin')
    sh(root, 'checkout', '-q', 'work')

    const base = await mergeBase(root)

    expect(base).toEqual({ ok: true, value: fork })
    expect((await section(root, 'branch')).map((file) => file.path)).toEqual(['mine.txt'])
  })
})

describe('fileDiff alignment', () => {
  it('pairs a replaced line and leaves context on both sides', async () => {
    const root = tracked()
    write(root, 'a.txt', 'one\nTWO\nthree\nfour\nfive\n')

    const diff = await hunksOf(root, 'unstaged', named(await section(root, 'unstaged'), 'a.txt'))
    const rows = diff.hunks.flatMap((hunk) => hunk.rows)

    expect(rows[0]).toMatchObject({ context: true, old: { line: 1, text: 'one' }, new: { line: 1, text: 'one' } })
    expect(rows[1]).toMatchObject({ context: false, old: { line: 2, text: 'two' }, new: { line: 2, text: 'TWO' } })
    expect(rows[2]).toMatchObject({ context: true, old: { line: 3 }, new: { line: 3 } })
  })

  it('leaves the old column blank for an added line', async () => {
    const root = tracked()
    write(root, 'a.txt', 'one\ntwo\nextra\nthree\nfour\nfive\n')

    const diff = await hunksOf(root, 'unstaged', named(await section(root, 'unstaged'), 'a.txt'))
    const added = diff.hunks.flatMap((hunk) => hunk.rows).filter((row) => row.old === null)

    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ old: null, new: { line: 3, text: 'extra' } })
  })

  it('leaves the new column blank for a removed line', async () => {
    const root = tracked()
    write(root, 'a.txt', 'one\nthree\nfour\nfive\n')

    const diff = await hunksOf(root, 'unstaged', named(await section(root, 'unstaged'), 'a.txt'))
    const removed = diff.hunks.flatMap((hunk) => hunk.rows).filter((row) => row.new === null)

    expect(removed).toHaveLength(1)
    expect(removed[0]).toMatchObject({ old: { line: 2, text: 'two' }, new: null })
  })

  it('keeps every row square when a block shrinks from three lines to one', async () => {
    const root = tracked()
    write(root, 'a.txt', 'one\nONLY\nfive\n')

    const diff = await hunksOf(root, 'unstaged', named(await section(root, 'unstaged'), 'a.txt'))
    const rows = diff.hunks.flatMap((hunk) => hunk.rows)
    const changed = rows.filter((row) => !row.context)

    expect(changed.map((row) => [row.old?.text ?? null, row.new?.text ?? null])).toEqual([
      ['two', 'ONLY'],
      ['three', null],
      ['four', null],
    ])
  })

  it('numbers every row from git, never from its position in the list', async () => {
    const root = tracked()
    write(root, 'a.txt', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n')
    sh(root, 'add', '-A')
    sh(root, 'commit', '-m', 'grow')
    write(root, 'a.txt', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n')

    const diff = await hunksOf(root, 'unstaged', named(await section(root, 'unstaged'), 'a.txt'))
    const rows = diff.hunks.flatMap((hunk) => hunk.rows)

    expect(diff.hunks[0]).toMatchObject({ oldStart: 7, newStart: 7 })
    expect(rows[0]?.old?.line).toBe(7)
    expect(rows.at(-1)).toMatchObject({ old: { line: 10, text: 'ten' }, new: { line: 10, text: 'TEN' } })
  })

  it('flags a missing trailing newline on the side that lacks it', async () => {
    const root = tracked()
    write(root, 'a.txt', 'one\ntwo\nthree\nfour\nfive')

    const diff = await hunksOf(root, 'unstaged', named(await section(root, 'unstaged'), 'a.txt'))
    const last = diff.hunks.flatMap((hunk) => hunk.rows).at(-1)

    expect(last?.old?.noNewline).toBe(false)
    expect(last?.new?.noNewline).toBe(true)
  })

  it('keeps a carriage return out of the line numbers and inside the text', async () => {
    const root = tracked()
    write(root, 'crlf.txt', 'one\r\ntwo\r\n')
    sh(root, 'add', '-A')
    sh(root, 'commit', '-m', 'crlf')
    write(root, 'crlf.txt', 'one\r\nTWO\r\n')

    const diff = await hunksOf(root, 'unstaged', named(await section(root, 'unstaged'), 'crlf.txt'))
    const changed = diff.hunks.flatMap((hunk) => hunk.rows).filter((row) => !row.context)

    expect(changed[0]?.old?.text).toBe('two\r')
    expect(changed[0]?.new?.text).toBe('TWO\r')
  })

  it('renders an untracked file as every line added', async () => {
    const root = tracked()
    write(root, 'fresh.txt', 'x\ny\n')

    const diff = await hunksOf(root, 'unstaged', named(await section(root, 'unstaged'), 'fresh.txt'))
    const rows = diff.hunks.flatMap((hunk) => hunk.rows)

    expect(rows).toEqual([
      { old: null, new: { line: 1, text: 'x', noNewline: false }, context: false },
      { old: null, new: { line: 2, text: 'y', noNewline: false }, context: false },
    ])
  })

  it('calls an untracked file binary rather than rendering its bytes', async () => {
    const root = tracked()
    write(root, 'fresh.bin', Buffer.from([104, 105, 0, 7, 255]))

    const diff = await hunksOf(root, 'unstaged', named(await section(root, 'unstaged'), 'fresh.bin'))

    expect(diff).toMatchObject({ binary: true, hunks: [] })
  })

  it('marks an untracked file that ends without a newline', async () => {
    const root = tracked()
    write(root, 'fresh.txt', 'x\ny')

    const diff = await hunksOf(root, 'unstaged', named(await section(root, 'unstaged'), 'fresh.txt'))

    expect(diff.hunks.flatMap((hunk) => hunk.rows).at(-1)).toMatchObject({ new: { line: 2, noNewline: true } })
  })

  it('follows a rename so the diff is the edit and not a whole rewrite', async () => {
    const root = tracked()
    sh(root, 'mv', 'a.txt', 'b.txt')
    write(root, 'b.txt', 'one\ntwo\nthree\nfour\nFIVE\n')
    sh(root, 'add', '-A')

    const file = named(await section(root, 'staged'), 'b.txt')
    const diff = await hunksOf(root, 'staged', file)
    const changed = diff.hunks.flatMap((hunk) => hunk.rows).filter((row) => !row.context)

    expect(file.from).toBe('a.txt')
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatchObject({ old: { text: 'five' }, new: { text: 'FIVE' } })
  })

  it('says a file is binary and parses nothing', async () => {
    const root = tracked()
    write(root, 'blob.bin', Buffer.from([0, 1, 2, 3, 0, 255]))
    sh(root, 'add', '-A')

    const diff = await hunksOf(root, 'staged', named(await section(root, 'staged'), 'blob.bin'))

    expect(diff).toMatchObject({ binary: true, hunks: [] })
  })

  it('refuses to parse a diff past the byte cap until it is asked twice', async () => {
    const root = tracked()
    const wide = `${'x'.repeat(200)}\n`
    write(root, 'huge.txt', wide.repeat(Math.ceil(MAX_DIFF_BYTES / wide.length) + 100))
    sh(root, 'add', '-A')

    const file = named(await section(root, 'staged'), 'huge.txt')
    const capped = await hunksOf(root, 'staged', file)
    const full = await hunksOf(root, 'staged', file, true)

    expect(capped).toMatchObject({ oversize: true, hunks: [] })
    expect(capped.bytes).toBeGreaterThan(MAX_DIFF_BYTES)
    expect(full.oversize).toBe(false)
    expect(full.hunks.flatMap((hunk) => hunk.rows).length).toBeGreaterThan(1000)
  })

  it('refuses a path carrying a NUL', async () => {
    const root = tracked()
    const file: ChangedFile = {
      path: 'a\0b',
      from: null,
      status: 'modified',
      similarity: null,
      added: 0,
      removed: 0,
      binary: false,
    }

    expect(await fileDiff(root, 'unstaged', file)).toEqual({ ok: false, error: { kind: 'bad-argument', value: 'a\0b' } })
  })
})

describe('staging', () => {
  it('stages a whole file and then unstages it', async () => {
    const root = tracked()
    write(root, 'a.txt', 'one\nTWO\nthree\nfour\nfive\n')

    await stageFile(root, named(await section(root, 'unstaged'), 'a.txt'))
    expect((await section(root, 'staged')).map((file) => file.path)).toEqual(['a.txt'])
    expect(await section(root, 'unstaged')).toEqual([])

    await unstageFile(root, named(await section(root, 'staged'), 'a.txt'))
    expect(await section(root, 'staged')).toEqual([])
    expect((await section(root, 'unstaged')).map((file) => file.path)).toEqual(['a.txt'])
  })

  it('stages an untracked file', async () => {
    const root = tracked()
    write(root, 'fresh.txt', 'x\n')

    await stageFile(root, named(await section(root, 'unstaged'), 'fresh.txt'))

    expect(named(await section(root, 'staged'), 'fresh.txt')).toMatchObject({ status: 'added' })
  })

  it('unstages both halves of a rename', async () => {
    const root = tracked()
    sh(root, 'mv', 'a.txt', 'b.txt')

    await unstageFile(root, named(await section(root, 'staged'), 'b.txt'))

    expect(await section(root, 'staged')).toEqual([])
    expect((await section(root, 'unstaged')).map((file) => file.path).sort()).toEqual(['a.txt', 'b.txt'])
  })

  it('unstages in a repo that has no commits yet', async () => {
    const root = tmp('unborn')
    sh(root, 'init', '-b', 'main', '.')
    write(root, 'a.txt', 'one\n')
    sh(root, 'add', '-A')

    const out = await unstageFile(root, named(await section(root, 'staged'), 'a.txt'))

    expect(out).toEqual({ ok: true, value: { path: 'a.txt' } })
    expect(await section(root, 'staged')).toEqual([])
  })
})
