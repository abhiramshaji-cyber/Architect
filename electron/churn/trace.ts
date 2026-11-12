import type { Hunk } from '../git/churn'

export type Range = { from: number; to: number }

function blocks(hunk: Hunk) {
  const old = hunk.oldCount > 0 ? hunk.oldStart - 1 : hunk.oldStart
  const placed = hunk.newCount > 0 ? hunk.newStart - 1 : hunk.newStart
  return { old, placed, end: placed + hunk.newCount, added: hunk.newCount > 0, shift: hunk.newCount - hunk.oldCount }
}

function startOf(at: number, hunks: Hunk[]): number {
  let delta = 0
  for (const hunk of hunks) {
    const { old, placed, end, added, shift } = blocks(hunk)
    if (added ? end <= at : placed <= at) {
      delta += shift
      continue
    }
    return added && placed <= at ? old : at - delta
  }
  return at - delta
}

function endOf(at: number, hunks: Hunk[]): number {
  let delta = 0
  for (const hunk of hunks) {
    const { old, placed, end, added, shift } = blocks(hunk)
    if (added ? end < at : placed < at) {
      delta += shift
      continue
    }
    return added && placed < at ? old + hunk.oldCount : at - delta
  }
  return at - delta
}

export function traceBack(range: Range, hunks: Hunk[]): { touched: boolean; parent: Range | null } {
  const touched = hunks.some((hunk) => {
    const { placed, end, added } = blocks(hunk)
    return added ? placed < range.to && end > range.from : range.from < placed && placed < range.to
  })
  const from = startOf(range.from, hunks)
  const to = endOf(range.to, hunks)
  return { touched, parent: to > from ? { from, to } : null }
}
