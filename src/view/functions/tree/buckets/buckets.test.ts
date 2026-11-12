import { describe, expect, it } from 'vitest'
import { WIDE, bucketsOf, type Item, type Split } from './index'

const item = (id: string, file?: string, component?: string, size = 1): Item => ({ id, name: id, size, file, component })

const many = (count: number, make: (at: number) => Item) => Array.from({ length: count }, (_, at) => make(at))

function leavesOf(split: Split, at: string): string[] {
  return (split.kids.get(at) ?? []).flatMap((id) => (split.made.has(id) ? leavesOf(split, id) : [id]))
}

function widest(split: Split): number {
  return Math.max(0, ...[...split.kids.values()].map((list) => list.length))
}

describe('bucketsOf', () => {
  it('leaves a level of at most WIDE cards alone', () => {
    const items = many(WIDE, (at) => item(`f${at}`, 'a.ts'))
    expect(bucketsOf('p', items).kids.get('p')).toEqual(items.map(({ id }) => id))
    expect(bucketsOf('p', items).made.size).toBe(0)
  })

  it('buckets by component first, largest first, with unowned functions under one card', () => {
    const items = [
      ...many(8, (at) => item(`a${at}`, `x/${at}.ts`, 'core')),
      ...many(4, (at) => item(`b${at}`, `y/${at}.ts`, 'ui')),
      ...many(3, (at) => item(`c${at}`, `z/${at}.ts`)),
    ]
    const split = bucketsOf('p', items)
    const top = split.kids.get('p') ?? []
    expect(top.map((id) => split.made.get(id)?.label)).toEqual(['core', 'ui', 'No component'])
    expect(top.map((id) => split.made.get(id)?.kind)).toEqual(['component', 'component', 'component'])
    expect(leavesOf(split, 'p').sort()).toEqual(items.map(({ id }) => id).sort())
  })

  it('falls back to folders when nothing names a component, and to files inside one folder', () => {
    const items = [...many(9, (at) => item(`a${at}`, `src/one/${at % 2}.ts`)), ...many(9, (at) => item(`b${at}`, `src/two/x.ts`))]
    const split = bucketsOf('p', items)
    const top = split.kids.get('p') ?? []
    expect(top.map((id) => split.made.get(id)?.label)).toEqual(['src/one/', 'src/two/'])
    expect(top.map((id) => split.made.get(id)?.kind)).toEqual(['folder', 'folder'])

    const files = bucketsOf('p', many(14, (at) => item(`f${at}`, `src/${at % 2}.ts`)))
    expect((files.kids.get('p') ?? []).map((id) => files.made.get(id)?.label)).toEqual(['src/0.ts', 'src/1.ts'])
  })

  it('splits one wide file by name range, in name order', () => {
    const items = many(30, (at) => item(`n${String(at).padStart(2, '0')}`, 'preload.ts', 'app'))
    const split = bucketsOf('p', items)
    const top = split.kids.get('p') ?? []
    expect(top.map((id) => split.made.get(id)?.label)).toEqual(['n00 … n09', 'n10 … n19', 'n20 … n29'])
    expect(top.every((id) => split.made.get(id)?.kind === 'names')).toBe(true)
  })

  it('never shows a bare card for a bucket of one, and keeps items without a file beside the buckets', () => {
    const items = [item('lone', 'b/x.ts'), ...many(13, (at) => item(`a${at}`, `a/${at}.ts`)), item('unreached')]
    const split = bucketsOf('p', items)
    expect(split.kids.get('p')).toEqual(['b:p>folder:a/', 'lone', 'unreached'])
  })

  it('keeps every level within WIDE, loses nothing and gives the same buckets every time', () => {
    for (const count of [13, 145, 1400, 5000]) {
      const items = many(count, (at) => item(`f${at}`, `d${at % 7}/e${at % 3}/${at % 40}.ts`, at % 5 === 0 ? undefined : `c${at % 23}`))
      const split = bucketsOf('p', items)
      expect(widest(split)).toBeLessThanOrEqual(WIDE)
      expect(leavesOf(split, 'p').sort()).toEqual(items.map(({ id }) => id).sort())
      expect(bucketsOf('p', [...items])).toEqual(split)
    }
  })

  it('handles names that sort equal and a level of only bucket cards', () => {
    const split = bucketsOf('p', many(200, (at) => ({ id: `f${at}`, name: 'same', size: 1 })))
    expect(widest(split)).toBeLessThanOrEqual(WIDE)
    expect(leavesOf(split, 'p')).toHaveLength(200)
    const labels = (split.kids.get('p') ?? []).map((id) => split.made.get(id)?.label)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels[0]).toBe(`same · part 1 of ${labels.length}`)
  })
})
