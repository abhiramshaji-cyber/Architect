import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FunctionRow } from '../../../../../shared/types'
import type { CardData } from './Card'
import Pill from './Pill'

const row: FunctionRow = {
  file: 'src/a.ts',
  name: 'load',
  line: 1,
  lines: 1,
  fanIn: 2,
  fanOut: 0,
  exported: false,
  entry: null,
  untraced: null,
  importance: 1,
}

const data = (over: Partial<CardData>): CardData => ({
  title: 'load',
  notes: [],
  pill: '2 callers',
  row: null,
  at: -1,
  count: 0,
  open: false,
  also: 0,
  elsewhere: 0,
  dim: false,
  focused: false,
  onToggle: () => {},
  onJump: () => {},
  onOpen: () => {},
  onRelated: () => {},
  onFocus: () => {},
  ...over,
})

describe('Pill', () => {
  it('shows only the name and the count', () => {
    const html = renderToStaticMarkup(<Pill id="f0" data={data({ row })} />)
    expect(html).toContain('>load<')
    expect(html).toContain('>2 callers<')
  })

  it('expands a card with children, opens a function without them and does nothing for an empty card', () => {
    expect(renderToStaticMarkup(<Pill id="f0" data={data({ row, count: 3, open: true })} />)).toContain('aria-expanded="true"')
    const leaf = renderToStaticMarkup(<Pill id="f0" data={data({ row })} />)
    expect(leaf).not.toContain('aria-expanded')
    expect(leaf).not.toContain('disabled')
    const empty = renderToStaticMarkup(<Pill id="g" data={data({ pill: '0 functions' })} />)
    expect(empty).toContain('disabled')
    expect(empty).not.toContain('aria-expanded')
  })
})
