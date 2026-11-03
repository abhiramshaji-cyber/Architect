import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyChange, rootOf } from './change'

const edit = (old: string, next: string, all = false) => ({ old, new: next, all })

describe('applyChange', () => {
  it('replaces the whole file for a write', () => {
    expect(applyChange('old', { tool: 'Write', file: '/p/a.ts', content: 'new' })).toBe('new')
  })

  it('replaces the one match of an edit', () => {
    expect(applyChange('a b c', { tool: 'Edit', file: '/p/a.ts', edits: [edit('b', 'B')] })).toBe('a B c')
  })

  it('keeps dollar signs literal', () => {
    expect(applyChange('x', { tool: 'Edit', file: '/p/a.ts', edits: [edit('x', '$&$1')] })).toBe('$&$1')
  })

  it('gives up when the old text is missing or ambiguous, as Claude Code would', () => {
    expect(applyChange('a b', { tool: 'Edit', file: '/p/a.ts', edits: [edit('z', 'Z')] })).toBeNull()
    expect(applyChange('b b', { tool: 'Edit', file: '/p/a.ts', edits: [edit('b', 'B')] })).toBeNull()
  })

  it('replaces every match when asked to', () => {
    expect(applyChange('b b', { tool: 'Edit', file: '/p/a.ts', edits: [edit('b', 'B', true)] })).toBe('B B')
  })

  it('creates a file from an empty old text only when the file is empty', () => {
    expect(applyChange('', { tool: 'Edit', file: '/p/a.ts', edits: [edit('', 'fresh')] })).toBe('fresh')
    expect(applyChange('taken', { tool: 'Edit', file: '/p/a.ts', edits: [edit('', 'fresh')] })).toBeNull()
  })

  it('applies a multi edit in order and fails as a whole', () => {
    const change = { tool: 'MultiEdit' as const, file: '/p/a.ts', edits: [edit('a', 'b'), edit('b c', 'done')] }
    expect(applyChange('a c', change)).toBe('done')
    expect(applyChange('a', { ...change, edits: [edit('a', 'b'), edit('zz', 'y')] })).toBeNull()
  })
})

describe('rootOf', () => {
  const at = (...parts: string[]) => path.join(path.sep, ...parts)
  const aliases = new Map([
    [at('code', 'app'), at('code', 'app')],
    [at('code', 'app', 'packages', 'ui'), at('code', 'app', 'packages', 'ui')],
    [at('private', 'code', 'lib'), at('code', 'lib')],
  ])

  it('picks the deepest project holding the file', () => {
    expect(rootOf(aliases, [at('code', 'app', 'packages', 'ui', 'button.tsx')])).toEqual({
      root: at('code', 'app', 'packages', 'ui'),
      file: at('code', 'app', 'packages', 'ui', 'button.tsx'),
      relative: 'button.tsx',
    })
  })

  it('maps a real path back to the project root it was opened as', () => {
    expect(rootOf(aliases, [at('elsewhere', 'x.ts'), at('private', 'code', 'lib', 'src', 'x.ts')])?.root).toBe(
      at('code', 'lib'),
    )
  })

  it('passes over a file outside every project or the root itself', () => {
    expect(rootOf(aliases, [at('code', 'other', 'x.ts')])).toBeNull()
    expect(rootOf(aliases, [at('code', 'app')])).toBeNull()
  })
})
