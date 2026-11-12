import type { LayerCell, Layers } from '../../../shared/types'

export type Span = { start: number; size: number }

export type Grid = { spans: Span[]; cellAt: (from: string, to: string) => LayerCell | undefined }

export function gridOf({ rows, cells }: Layers): Grid {
  const spans: Span[] = []
  for (const [at, row] of rows.entries()) {
    const last = spans.at(-1)
    if (last && rows[at - 1]?.block === row.block) last.size += 1
    else spans.push({ start: at, size: 1 })
  }

  const byPair = new Map<string, Map<string, LayerCell>>()
  for (const cell of cells) byPair.set(cell.from, (byPair.get(cell.from) ?? new Map()).set(cell.to, cell))

  return { spans: spans.filter((span) => span.size > 1), cellAt: (from, to) => byPair.get(from)?.get(to) }
}
