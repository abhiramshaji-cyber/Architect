export type Rect = { x: number; y: number; w: number; h: number }

const usable = (weight: number) => (Number.isFinite(weight) && weight > 0 ? weight : 0)

function worst(sum: number, largest: number, smallest: number, side: number): number {
  return Math.max((side * side * largest) / (sum * sum), (sum * sum) / (side * side * smallest))
}

export function squarify(weights: number[], box: Rect): (Rect | null)[] {
  const placed: (Rect | null)[] = weights.map(() => null)
  const clean = weights.map(usable)
  const total = clean.reduce((a, b) => a + b, 0)
  if (total <= 0 || !(box.w > 0) || !(box.h > 0)) return placed

  const scale = (box.w * box.h) / total
  const order = clean
    .map((weight, at) => ({ at, area: weight * scale }))
    .filter(({ area }) => area > 0)
    .sort((a, b) => b.area - a.area || a.at - b.at)
  let { x, y, w, h } = box

  const lay = (row: typeof order, sum: number, last: boolean) => {
    const across = w >= h
    const thick = last ? (across ? w : h) : sum / (across ? h : w)
    let offset = 0
    row.forEach(({ at, area }, i) => {
      const length = i === row.length - 1 ? (across ? h : w) - offset : area / thick
      placed[at] = across ? { x, y: y + offset, w: thick, h: length } : { x: x + offset, y, w: length, h: thick }
      offset += length
    })
    if (across) {
      x += thick
      w -= thick
    } else {
      y += thick
      h -= thick
    }
  }

  let row: typeof order = []
  let sum = 0
  for (const item of order) {
    const side = Math.min(w, h)
    const first = row[0]
    if (
      first &&
      worst(sum + item.area, first.area, item.area, side) >
        worst(sum, first.area, row[row.length - 1]?.area ?? item.area, side)
    ) {
      lay(row, sum, false)
      row = []
      sum = 0
    }
    row.push(item)
    sum += item.area
  }
  if (row.length > 0) lay(row, sum, true)
  return placed
}
