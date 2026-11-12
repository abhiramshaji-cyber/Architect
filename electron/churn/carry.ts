import type { Hunk } from '../git/churn'

export type Span = { from: number; to: number; gap?: true }

function edges(hunk: Hunk) {
  const start = hunk.oldCount > 0 ? hunk.oldStart - 1 : hunk.oldStart
  const placed = hunk.newCount > 0 ? hunk.newStart - 1 : hunk.newStart
  return { start, stop: start + hunk.oldCount, placed, end: placed + hunk.newCount }
}

function side(at: number, hunks: Hunk[], before: boolean): { at: number; replaced: boolean } {
  let delta = 0
  for (const hunk of hunks) {
    const { start, stop, placed, end } = edges(hunk)
    if (at < start || (at === start && (hunk.oldCount > 0 || before))) break
    if (at < stop) return { at: before ? placed : end, replaced: true }
    delta += hunk.newCount - hunk.oldCount
  }
  return { at: at + delta, replaced: false }
}

function gapThrough(span: Span, hunks: Hunk[]): Span {
  const low = side(span.from, hunks, true)
  const high = side(span.to, hunks, false)
  const to = Math.max(low.at, high.at)
  return (low.replaced || high.replaced) && to > low.at ? { from: low.at, to } : { from: low.at, to, gap: true }
}

function through(span: Span, hunks: Hunk[]): Span[] {
  if (span.gap) return [gapThrough(span, hunks)]

  const out: Span[] = []
  let { from } = span
  let delta = 0
  for (const hunk of hunks) {
    const { start, stop, placed, end } = edges(hunk)
    if (stop <= from) {
      delta += hunk.newCount - hunk.oldCount
      continue
    }
    if (start >= span.to) break

    if (from < start) out.push({ from: from + delta, to: start + delta })
    if (hunk.oldCount > 0) out.push(end > placed ? { from: placed, to: end } : { from: placed, to: placed, gap: true })
    delta += hunk.newCount - hunk.oldCount
    from = stop
    if (from >= span.to) return out
  }

  out.push({ from: from + delta, to: span.to + delta })
  return out
}

export function carry(span: Span, later: Hunk[][]): Span[] {
  return later.reduce((spans, hunks) => spans.flatMap((piece) => through(piece, hunks)), [span])
}
