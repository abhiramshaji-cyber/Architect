import { describe, expect, it } from 'vitest'
import type { LayerCell, LayerRow } from '../../../shared/types'
import { gridOf } from './grid'

const row = (id: string, block: number): LayerRow => ({ id, level: 1, block })
const cell = (from: string, to: string): LayerCell => ({ from, to, status: 'free', calls: [] })

describe('gridOf', () => {
  it('outlines only blocks with more than one member', () => {
    const rows = [row('a', 0), row('b', 1), row('c', 1), row('d', 2), row('e', 3), row('f', 3), row('g', 3)]
    expect(gridOf({ contract: true, rows, cells: [] }).spans).toEqual([
      { start: 1, size: 2 },
      { start: 4, size: 3 },
    ])
  })

  it('returns no spans for an empty or acyclic matrix', () => {
    expect(gridOf({ contract: false, rows: [], cells: [] }).spans).toEqual([])
    expect(gridOf({ contract: false, rows: [row('a', 0), row('b', 1)], cells: [] }).spans).toEqual([])
  })

  it('finds a cell by its pair, keeping ids with separators apart', () => {
    const cells = [cell('a,b', 'c'), cell('a', 'b,c'), cell('a', 'd')]
    const { cellAt } = gridOf({ contract: false, rows: [], cells })
    expect(cellAt('a,b', 'c')).toBe(cells[0])
    expect(cellAt('a', 'b,c')).toBe(cells[1])
    expect(cellAt('a', 'd')).toBe(cells[2])
    expect(cellAt('d', 'a')).toBeUndefined()
  })
})
