import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readHistory } from '.'
import { parseNumstat } from './numstat'
import { createPatchReader } from './patch'
import { streamLines } from './stream'

const dirs: string[] = []

function repo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'architect-churn-')))
  dirs.push(dir)
  run(dir, 'init', '-q', '-b', 'main')
  run(dir, 'config', 'user.email', 't@t')
  run(dir, 'config', 'user.name', 't')
  return dir
}

const run = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

function write(dir: string, file: string, text: string | Buffer) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  fs.writeFileSync(path.join(dir, file), text)
}

function commit(dir: string, message: string) {
  run(dir, 'add', '-A')
  run(dir, 'commit', '-q', '--allow-empty', '-m', message)
}

afterAll(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })))

describe('parseNumstat', () => {
  it('reads commits, counts, binary files and renames with odd paths', () => {
    const out =
      '\x1eaaa\x1f10\0\n3\t1\tsrc/a b.ts\0-\t-\timg.png\0' +
      '\x1ebbb\x1f20\0\n0\t0\t\0old\tname.ts\0new\nname.ts\0' +
      '\x1eccc\x1f30\0'
    expect(parseNumstat(out)).toEqual([
      {
        sha: 'aaa',
        at: 10_000,
        files: [
          { path: 'src/a b.ts', added: 3, removed: 1, binary: false },
          { path: 'img.png', added: 0, removed: 0, binary: true },
        ],
      },
      { sha: 'bbb', at: 20_000, files: [{ path: 'new\nname.ts', from: 'old\tname.ts', added: 0, removed: 0, binary: false }] },
      { sha: 'ccc', at: 30_000, files: [] },
    ])
  })

  it('reads a rename whose paths look like a commit header', () => {
    expect(parseNumstat('\x1eaaa\x1f1\0\n1\t0\t\0\x1efrom\0\x1eto\0')[0]?.files).toEqual([
      { path: '\x1eto', from: '\x1efrom', added: 1, removed: 0, binary: false },
    ])
  })

  it('puts entries with no header into one commit with no sha', () => {
    expect(parseNumstat('2\t0\ta.ts\0')).toEqual([{ sha: '', at: 0, files: [{ path: 'a.ts', added: 2, removed: 0, binary: false }] }])
  })

  it('returns nothing for empty output', () => {
    expect(parseNumstat('')).toEqual([])
  })
})

describe('createPatchReader', () => {
  const read = (lines: string[]) => {
    const reader = createPatchReader()
    lines.forEach(reader.line)
    return reader.commits()
  }

  it('keeps hunk headers and skips hunk bodies, even ones that look like headers', () => {
    expect(
      read([
        '\x1eaaa\x1f10',
        '',
        'diff --git a/a.ts b/a.ts',
        'index 1..2 100644',
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -2,2 +2,3 @@ function a',
        '-diff --git a/x b/x',
        '-@@ -1 +1 @@',
        '+\x1enot a commit',
        '+new file mode 100644',
        '++++ b/x',
        '@@ -9 +10,0 @@',
        '-gone',
        '\\ No newline at end of file',
        'diff --git a/b.png b/b.png',
        'new file mode 100644',
        'Binary files /dev/null and b/b.png differ',
        '\x1ebbb\x1f20',
        'diff --git a/c.ts b/c.ts',
        'deleted file mode 100644',
        '@@ -1 +0,0 @@',
        '-x',
      ]),
    ).toEqual([
      {
        sha: 'aaa',
        sections: [
          {
            created: false,
            deleted: false,
            hunks: [
              { oldStart: 2, oldCount: 2, newStart: 2, newCount: 3 },
              { oldStart: 9, oldCount: 1, newStart: 10, newCount: 0 },
            ],
          },
          { created: true, deleted: false, hunks: [] },
        ],
      },
      { sha: 'bbb', sections: [{ created: false, deleted: true, hunks: [{ oldStart: 1, oldCount: 1, newStart: 0, newCount: 0 }] }] },
    ])
  })

  it('does not count a no newline marker inside a hunk as a body line', () => {
    const [commit] = read(['diff --git a/a b/a', '@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b', '@@ -5 +5 @@', '-c', '+d'])
    expect(commit?.sections[0]?.hunks).toHaveLength(2)
  })
})

describe('streamLines', () => {
  it('splits only on newlines and keeps a carriage return inside a line', async () => {
    const dir = repo()
    write(dir, 'a.txt', 'one\r\ntwo\rthree')
    commit(dir, 'first')
    const lines: string[] = []

    expect(await streamLines(dir, ['show', 'HEAD:a.txt'], (line) => lines.push(line))).toBe(true)
    expect(lines).toEqual(['one\r', 'two\rthree'])
  })

  it('reports a failing command', async () => {
    expect(await streamLines(repo(), ['log'], () => {})).toBe(false)
  })
})

describe('readHistory', () => {
  it('returns no history for a repo with no commits or no repo at all', async () => {
    expect(await readHistory(repo(), 0)).toEqual({ commits: [], working: null, complete: true })
    expect(await readHistory(fs.mkdtempSync(path.join(os.tmpdir(), 'architect-none-')), 0)).toEqual({ commits: [], working: null, complete: true })
  })

  it('matches git log --numstat and pairs every file with its hunks', async () => {
    const dir = repo()
    write(dir, 'src/a.ts', 'a\nb\nc\n')
    write(dir, 'logo.png', Buffer.from([0, 1, 2, 3]))
    commit(dir, 'first')
    write(dir, 'src/a.ts', 'a\nB\nc\nd\n')
    commit(dir, 'second')
    run(dir, 'mv', 'src/a.ts', 'src/moved.ts')
    commit(dir, 'third')
    commit(dir, 'empty')

    const history = await readHistory(dir, 0)
    const numstat = run(dir, 'log', '--numstat', '--format=%x1e%H', '--', '.')
      .split('\x1e')
      .filter(Boolean)
      .map((block) => block.trim().split('\n').slice(1).filter(Boolean).map((line) => line.split('\t').slice(0, 2).join(' ')))

    expect(history.commits.map((c) => c.files.map((f) => (f.binary ? '- -' : `${f.added} ${f.removed}`)))).toEqual(numstat)
    expect(history.commits.map((c) => c.files.map((f) => [f.path, f.from, f.created, f.hunks]))).toEqual([
      [['src/moved.ts', 'src/a.ts', false, []]],
      [['src/a.ts', undefined, false, [{ oldStart: 2, oldCount: 1, newStart: 2, newCount: 1 }, { oldStart: 3, oldCount: 0, newStart: 4, newCount: 1 }]]],
      [
        ['logo.png', undefined, true, []],
        ['src/a.ts', undefined, true, [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 3 }]],
      ],
    ])
    expect(history.working).toBeNull()
    expect(history.complete).toBe(true)
  })

  it('reads uncommitted changes and limits commits to the window', async () => {
    const dir = repo()
    write(dir, 'a.ts', 'a\n')
    commit(dir, 'first')
    write(dir, 'a.ts', 'a\nb\n')

    const history = await readHistory(dir, Date.now() + 86_400_000)
    expect(history.commits).toEqual([])
    expect(history.working?.files).toEqual([
      { path: 'a.ts', added: 1, removed: 0, binary: false, created: false, deleted: false, hunks: [{ oldStart: 1, oldCount: 0, newStart: 2, newCount: 1 }] },
    ])
  })

  it('reads only the project folder of a larger repo, with paths relative to it', async () => {
    const dir = repo()
    write(dir, 'app/x.ts', 'x\n')
    write(dir, 'other/y.ts', 'y\n')
    commit(dir, 'first')

    const history = await readHistory(path.join(dir, 'app'), 0)
    expect(history.commits.flatMap((c) => c.files.map((f) => f.path))).toEqual(['x.ts'])
  })
})
