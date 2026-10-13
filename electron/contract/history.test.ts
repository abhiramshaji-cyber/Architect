import { describe, expect, it } from 'vitest'
import type { Architecture, CodeMap, FunctionEntry } from '../../shared/types'
import { codeDiff, contractDiff, isEmpty } from './history'

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
