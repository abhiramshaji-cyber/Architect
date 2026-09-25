import { describe, expect, it } from 'vitest'
import {
  at,
  clampPath,
  clampRatio,
  close,
  focusDir,
  leaf,
  MIN_RATIO,
  parse,
  resize,
  serialize,
  setView,
  split,
  type Pane,
} from './pane-tree'

const known = (view: string) => view === 'contract' || view === 'code'

function deep(depth: number): Pane {
  let pane = leaf('contract')
  for (let i = 0; i < depth; i++) pane = { kind: 'split', axis: i % 2 ? 'row' : 'col', a: pane, b: leaf('code'), ratio: 0.5 }
  return pane
}

describe('split', () => {
  it('splits a single leaf along a row', () => {
    const tree = split(leaf('contract'), [], 'row', 'code')
    expect(tree).toEqual({ kind: 'split', axis: 'row', a: leaf('contract'), b: leaf('code'), ratio: 0.5 })
  })

  it('splits a single leaf along a column', () => {
    const tree = split(leaf('contract'), [], 'col', 'code')
    expect(tree.kind === 'split' && tree.axis).toBe('col')
  })

  it('splits a nested leaf and leaves its sibling alone', () => {
    const one = split(leaf('contract'), [], 'row', 'code')
    const two = split(one, ['b'], 'col', 'contract')
    expect(at(two, ['a'])).toEqual(leaf('contract'))
    expect(at(two, ['b', 'a'])).toEqual(leaf('code'))
    expect(at(two, ['b', 'b'])).toEqual(leaf('contract'))
  })

  it('ignores a path that runs past a leaf', () => {
    const tree = leaf('contract')
    expect(split(tree, ['a', 'b'], 'row', 'code')).toBe(tree)
  })
})

describe('close', () => {
  it('collapses a split into its remaining sibling', () => {
    const tree = split(leaf('contract'), [], 'row', 'code')
    expect(close(tree, ['b'])).toEqual(leaf('contract'))
    expect(close(tree, ['a'])).toEqual(leaf('code'))
  })

  it('collapses only the nearest split when nested', () => {
    const tree = split(split(leaf('contract'), [], 'row', 'code'), ['b'], 'col', 'contract')
    expect(close(tree, ['b', 'b'])).toEqual(split(leaf('contract'), [], 'row', 'code'))
  })

  it('returns null when the last pane closes', () => {
    expect(close(leaf('contract'), [])).toBeNull()
  })
})

describe('resize', () => {
  it('clamps below the minimum', () => {
    const tree = resize(split(leaf('contract'), [], 'row', 'code'), [], -4)
    expect(tree.kind === 'split' && tree.ratio).toBe(MIN_RATIO)
  })

  it('clamps above the maximum', () => {
    const tree = resize(split(leaf('contract'), [], 'row', 'code'), [], 9)
    expect(tree.kind === 'split' && tree.ratio).toBe(1 - MIN_RATIO)
  })

  it('falls back to an even ratio for a non finite value', () => {
    expect(clampRatio(Number.NaN)).toBe(0.5)
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(0.5)
  })

  it('keeps a ratio inside the range', () => {
    const tree = resize(split(leaf('contract'), [], 'row', 'code'), [], 0.72)
    expect(tree.kind === 'split' && tree.ratio).toBe(0.72)
  })

  it('ignores a path pointing at a leaf', () => {
    const tree = leaf('contract')
    expect(resize(tree, [], 0.3)).toBe(tree)
  })
})

describe('focusDir', () => {
  const tree = split(leaf('contract'), [], 'row', 'code')

  it('moves across a row split', () => {
    expect(focusDir(tree, ['a'], 'right')).toEqual(['b'])
    expect(focusDir(tree, ['b'], 'left')).toEqual(['a'])
  })

  it('stays put when the direction has no neighbour', () => {
    expect(focusDir(tree, ['a'], 'up')).toEqual(['a'])
    expect(focusDir(leaf('contract'), [], 'right')).toEqual([])
  })

  it('walks up past a mismatched axis and lands on the near edge', () => {
    const nested = split(tree, ['a'], 'col', 'contract')
    expect(focusDir(nested, ['a', 'b'], 'right')).toEqual(['b'])
    expect(focusDir(nested, ['b'], 'left')).toEqual(['a', 'a'])
  })

  it('reaches a leaf in a deeply nested tree', () => {
    const tall = deep(12)
    const path = clampPath(tall, [])
    expect(at(tall, focusDir(tall, path, 'down'))?.kind).toBe('leaf')
  })
})

describe('clampPath', () => {
  it('trims a path that no longer exists', () => {
    expect(clampPath(leaf('contract'), ['a', 'b'])).toEqual([])
  })

  it('descends to a leaf when the path stops on a split', () => {
    const tree = split(split(leaf('contract'), [], 'row', 'code'), ['a'], 'col', 'code')
    expect(at(tree, clampPath(tree, ['a']))?.kind).toBe('leaf')
  })
})

describe('setView', () => {
  it('swaps the view of one leaf', () => {
    const tree = setView(split(leaf('contract'), [], 'row', 'code'), ['a'], 'code')
    expect(at(tree, ['a'])).toEqual(leaf('code'))
  })
})

describe('serialize and parse', () => {
  it('round trips a nested tree', () => {
    const tree = resize(split(split(leaf('contract'), [], 'row', 'code'), ['b'], 'col', 'contract'), [], 0.3)
    expect(parse(serialize(tree), known)).toEqual(tree)
  })

  it('round trips a deeply nested tree', () => {
    const tree = deep(50)
    expect(parse(serialize(tree), known)).toEqual(tree)
  })

  it('rejects garbage', () => {
    for (const bad of ['', 'not json', '[]', 'null', '42', '"leaf"', '{}', '{"kind":"branch"}']) {
      expect(parse(bad, known)).toBeNull()
    }
  })

  it('rejects a split with a bad axis or ratio', () => {
    expect(parse('{"kind":"split","axis":"diag","a":{"kind":"leaf","view":"code"},"b":{"kind":"leaf","view":"code"},"ratio":0.5}', known)).toBeNull()
    expect(parse('{"kind":"split","axis":"row","a":{"kind":"leaf","view":"code"},"b":{"kind":"leaf","view":"code"},"ratio":"half"}', known)).toBeNull()
  })

  it('rejects an unknown view', () => {
    expect(parse('{"kind":"leaf","view":"terminal"}', known)).toBeNull()
  })

  it('clamps a stored ratio that would hide a pane', () => {
    const stored = '{"kind":"split","axis":"row","a":{"kind":"leaf","view":"code"},"b":{"kind":"leaf","view":"code"},"ratio":0}'
    const tree = parse(stored, known)
    expect(tree?.kind === 'split' && tree.ratio).toBe(MIN_RATIO)
  })

  it('collapses a split whose child is no longer a known view', () => {
    const stored = '{"kind":"split","axis":"row","a":{"kind":"leaf","view":"terminal"},"b":{"kind":"leaf","view":"code"},"ratio":0.5}'
    expect(parse(stored, known)).toEqual(leaf('code'))
  })
})
