import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { EditorState, type Extension } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { definitionOf, definitionsIn, outlineOf, wordAt } from './symbols'
import { advance, EMPTY_TRAIL, leave, retreat } from './trail'

const TS = [
  "import { helper } from './helper'",
  'export const LIMIT = 3',
  'export function main(arg: number) {',
  '  const inner = helper(arg)',
  '  return inner + LIMIT',
  '}',
  'class Box { open() { return main(1) } }',
  'type Shape = { side: number }',
].join('\n')

function stateOf(doc: string, language: Extension): EditorState {
  return EditorState.create({ doc, extensions: [language] })
}

describe('definitionsIn', () => {
  const state = stateOf(TS, javascript({ typescript: true }))
  const all = definitionsIn(state)

  it('lists module symbols without imports, params or locals', () => {
    expect(outlineOf(all).map((d) => `${d.kind} ${d.name} ${d.line}`)).toEqual([
      'variable LIMIT 2',
      'function main 3',
      'class Box 7',
      'method open 7',
      'type Shape 8',
    ])
  })

  it('resolves a use to the nearest definition before it, and flags imports', () => {
    const use = TS.indexOf('inner +')
    expect(definitionOf(all, 'inner', use)?.line).toBe(4)
    expect(definitionOf(all, 'helper', TS.indexOf('helper(arg)'))?.imported).toBe(true)
    expect(definitionOf(all, 'missing', use)).toBeNull()
  })

  it('reads the word under the cursor', () => {
    expect(wordAt(state, TS.indexOf('main(1)') + 2)?.name).toBe('main')
  })

  it('finds python functions and classes', () => {
    const py = definitionsIn(stateOf('def run(a):\n  pass\nclass Job:\n  def go(self): pass', python()))
    expect(outlineOf(py).map((d) => d.name)).toEqual(['run', 'Job', 'go'])
  })

  it('returns nothing for plain text', () => {
    expect(definitionsIn(stateOf('just words', []))).toEqual([])
  })
})

describe('trail', () => {
  const a = { path: 'a.ts', line: 1 }
  const b = { path: 'b.ts', line: 9 }
  const c = { path: 'a.ts', line: 40 }

  it('walks back and forward through jumps', () => {
    const trail = leave(leave(EMPTY_TRAIL, a), b)
    const back = retreat(trail, c)
    expect(back?.to).toEqual(b)
    const forward = advance(back!.trail, b)
    expect(forward?.to).toEqual(c)
  })

  it('has nowhere to go when empty, and a new jump clears forward', () => {
    expect(retreat(EMPTY_TRAIL, a)).toBeNull()
    expect(advance(EMPTY_TRAIL, a)).toBeNull()
    const back = retreat(leave(EMPTY_TRAIL, a), b)!
    expect(leave(back.trail, a).forward).toEqual([])
  })

  it('does not record the same spot twice in a row', () => {
    expect(leave(leave(EMPTY_TRAIL, a), a).back).toEqual([a])
  })
})
