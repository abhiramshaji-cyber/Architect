import { describe, expect, it } from 'vitest'
import type { Architecture, CodeMap, FunctionEntry } from '../../shared/types'
import { attribute, codeDiff, contractDiff, isEmpty } from './history'

const architecture = (components: [string, string][], edges: [string, string][] = []): Architecture => ({
  title: 't',
  summary: 's',
  components: components.map(([id, purpose]) => ({ id, purpose, owns: [] })),
  edges: edges.map(([from, to]) => ({ from, to })),
  forbidden: [],
  packages: [],
})

const fn = (name: string): FunctionEntry => ({ name, line: 1, endLine: 2, description: '', calls: [] })

const map = (files: Record<string, string[]>): CodeMap => {
  const folders = new Map<string, CodeMap['folders'][number]>([['', { path: '', folders: [], files: [] }]])
  for (const [file, names] of Object.entries(files)) {
    const parts = file.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      if (folders.has(dir)) continue
      folders.set(dir, { path: dir, folders: [], files: [] })
      folders.get(parts.slice(0, i - 1).join('/'))?.folders.push(dir)
    }
    folders.get(parts.slice(0, -1).join('/'))?.files.push({ path: file, functions: names.map(fn) })
  }
  return { root: '/r', scannedAt: 1, folders: [...folders.values()] }
}

describe('contractDiff', () => {
  it('names added, changed and removed components and edges by their graph ids', () => {
    const before = architecture([['api', 'serves'], ['db', 'stores'], ['old', 'gone']], [['api', 'old']])
    const after = architecture([['api', 'serves http'], ['db', 'stores'], ['ui', 'draws']], [['ui', 'api']])

    expect(contractDiff(before, after)).toEqual({
      added: ['ui', 'ui->api'],
      changed: ['api'],
      removed: ['old', 'api->old'],
    })
  })

  it('treats a missing contract as empty on either side', () => {
    const one = architecture([['api', 'serves']])
    expect(contractDiff(null, one)).toEqual({ added: ['api'], changed: [], removed: [] })
    expect(contractDiff(one, null)).toEqual({ added: [], changed: [], removed: ['api'] })
  })

  it('is empty when only the title, summary or layout moved', () => {
    const before = architecture([['api', 'serves']])
    expect(isEmpty(contractDiff(before, { ...before, title: 'x', layout: { api: { x: 1, y: 2 } } }))).toBe(true)
  })
})

describe('codeDiff', () => {
  it('diffs files by their functions and marks every enclosing folder changed', () => {
    const before = map({ 'src/a/x.ts': ['one'], 'src/b/y.ts': ['two'], 'lib/z.ts': ['three'] })
    const after = map({ 'src/a/x.ts': ['one', 'four'], 'src/b/y.ts': ['two'], 'src/c/new.ts': ['five'] })

    expect(codeDiff(before, after)).toEqual({
      added: ['folder:src/c', 'codefile:src/c/new.ts'],
      changed: ['codefile:src/a/x.ts', 'folder:src', 'folder:src/a'],
      removed: ['folder:lib', 'codefile:lib/z.ts'],
    })
  })

  it('marks a touched file changed even when its functions did not move', () => {
    const same = map({ 'src/x.ts': ['one'], 'src/y.ts': ['two'] })
    expect(codeDiff(same, same, ['src/x.ts'])).toEqual({
      added: [],
      changed: ['codefile:src/x.ts', 'folder:src'],
      removed: [],
    })
  })

  it('is empty when nothing moved and nothing was touched', () => {
    const same = map({ 'src/x.ts': ['one'] })
    expect(isEmpty(codeDiff(same, map({ 'src/x.ts': ['one'] })))).toBe(true)
    expect(isEmpty(codeDiff(same, same, ['src/missing.ts']))).toBe(true)
  })

  it('never marks a folder whose name only shares a prefix with a changed path', () => {
    const before = map({ 'src/x.ts': ['one'], 'srcs/y.ts': ['two'] })
    const after = map({ 'src/x.ts': ['one', 'two'], 'srcs/y.ts': ['two'] })
    expect(codeDiff(before, after).changed).toEqual(['codefile:src/x.ts', 'folder:src'])
  })
})

describe('attribute', () => {
  const before = map({ 'a/x.ts': ['x'], 'b/y.ts': ['y'] })

  it('gives every change to the one session that touched its file', () => {
    const after = map({ 'a/x.ts': ['x', 'x2'], 'b/y.ts': ['y'] })
    const touches = [{ file: 'a/x.ts', session: 's1' }]

    expect(attribute(codeDiff(before, after, ['a/x.ts']), touches)).toEqual([
      { added: [], changed: ['codefile:a/x.ts', 'folder:a'], removed: [], file: 'a/x.ts', session: 's1' },
    ])
  })

  it('records a change nobody touched with no session and no file', () => {
    const after = map({ 'a/x.ts': ['x'], 'b/y.ts': ['y', 'y2'] })

    expect(attribute(codeDiff(before, after), [])).toEqual([
      { added: [], changed: ['codefile:b/y.ts', 'folder:b'], removed: [] },
    ])
  })

  it('splits one rescan into an entry per session and one for the rest', () => {
    const after = map({ 'a/x.ts': ['x', 'x2'], 'b/y.ts': ['y', 'y2'], 'c/z.ts': ['z'] })
    const touches = [
      { file: 'a/x.ts', session: 's1' },
      { file: 'b/y.ts', session: 's2' },
    ]

    expect(attribute(codeDiff(before, after, ['a/x.ts', 'b/y.ts']), touches)).toEqual([
      { added: ['folder:c', 'codefile:c/z.ts'], changed: [], removed: [] },
      { added: [], changed: ['codefile:a/x.ts', 'folder:a'], removed: [], file: 'a/x.ts', session: 's1' },
      { added: [], changed: ['codefile:b/y.ts', 'folder:b'], removed: [], file: 'b/y.ts', session: 's2' },
    ])
  })

  it.each([
    ['two sessions', [{ session: 's1' }, { session: 's2' }]],
    ['a session and a hook without one', [{ session: 's1' }, {}]],
    ['a hook without one and then a session', [{}, { session: 's1' }]],
    ['three touches that disagree once', [{ session: 's1' }, { session: 's2' }, { session: 's2' }]],
  ])('never guesses a session when %s touched the same file', (_name, sessions) => {
    const after = map({ 'a/x.ts': ['x', 'x2'], 'b/y.ts': ['y'] })
    const touches = sessions.map((s) => ({ file: 'a/x.ts', ...s }))

    expect(attribute(codeDiff(before, after, ['a/x.ts']), touches)).toEqual([
      { added: [], changed: ['codefile:a/x.ts', 'folder:a'], removed: [], file: 'a/x.ts' },
    ])
  })

  it('keeps a session when the same session touched a file twice', () => {
    const after = map({ 'a/x.ts': ['x', 'x2'], 'b/y.ts': ['y'] })
    const touches = [
      { file: 'a/x.ts', session: 's1' },
      { file: 'a/x.ts', session: 's1' },
    ]

    expect(attribute(codeDiff(before, after, ['a/x.ts']), touches)[0]?.session).toBe('s1')
  })

  it('leaves a folder with no session when two sessions changed files inside it', () => {
    const start = map({ 'a/x.ts': ['x'], 'a/w.ts': ['w'] })
    const after = map({ 'a/x.ts': ['x', 'x2'], 'a/w.ts': ['w', 'w2'] })
    const touches = [
      { file: 'a/x.ts', session: 's1' },
      { file: 'a/w.ts', session: 's2' },
    ]

    expect(attribute(codeDiff(start, after, ['a/x.ts', 'a/w.ts']), touches)).toEqual([
      { added: [], changed: ['folder:a'], removed: [] },
      { added: [], changed: ['codefile:a/x.ts'], removed: [], file: 'a/x.ts', session: 's1' },
      { added: [], changed: ['codefile:a/w.ts'], removed: [], file: 'a/w.ts', session: 's2' },
    ])
  })

  it('gives a removed file and its removed folder to the session that deleted it', () => {
    const after = map({ 'b/y.ts': ['y'] })

    expect(attribute(codeDiff(before, after, ['a/x.ts']), [{ file: 'a/x.ts', session: 's1' }])).toEqual([
      { added: [], changed: [], removed: ['folder:a', 'codefile:a/x.ts'], file: 'a/x.ts', session: 's1' },
    ])
  })

  it('returns nothing for an empty diff', () => {
    expect(attribute(codeDiff(before, before), [{ file: 'a/x.ts', session: 's1' }])).toEqual([])
  })
})
