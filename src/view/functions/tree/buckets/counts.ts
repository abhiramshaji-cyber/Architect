export type Tally = { functions: number; starts: number; callsIn: number; callsOut: number }

export function preorderOf(kids: Map<string, string[]>, root: string): string[] {
  const order: string[] = []
  const seen = new Set<string>()
  const stack = [root]
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (seen.has(id)) continue
    seen.add(id)
    order.push(id)
    stack.push(...[...(kids.get(id) ?? [])].reverse())
  }
  return order
}

export function sizesOf(kids: Map<string, string[]>, root: string, weigh: (id: string) => number): Map<string, number> {
  const sizes = new Map<string, number>()
  for (const id of preorderOf(kids, root).reverse()) {
    const below = (kids.get(id) ?? []).reduce((sum, kid) => sum + (sizes.get(kid) ?? 0), 0)
    sizes.set(id, weigh(id) + below)
  }
  return sizes
}

export function talliesOf(
  kids: Map<string, string[]>,
  root: string,
  ids: Iterable<string>,
  calls: Map<string, string[]>,
  starts: Set<string>,
): Map<string, Tally> {
  const order = preorderOf(kids, root)
  const place = new Map(order.map((id, at) => [id, at]))
  const span = sizesOf(kids, root, () => 1)
  const functions = sizesOf(kids, root, (id) => (calls.has(id) ? 1 : 0))
  const begun = sizesOf(kids, root, (id) => (starts.has(id) ? 1 : 0))
  const callers = new Map<string, string[]>()
  for (const [from, out] of calls) {
    for (const to of out) {
      const list = callers.get(to)
      if (list) list.push(from)
      else callers.set(to, [from])
    }
  }

  const tallies = new Map<string, Tally>()
  for (const id of ids) {
    const first = place.get(id)
    if (first === undefined) continue
    const end = first + (span.get(id) ?? 1)
    const outside = (other: string) => {
      const spot = place.get(other)
      return spot === undefined || spot < first || spot >= end
    }
    let callsIn = 0
    let callsOut = 0
    for (const inner of order.slice(first, end)) {
      callsOut += (calls.get(inner) ?? []).filter(outside).length
      callsIn += (callers.get(inner) ?? []).filter(outside).length
    }
    tallies.set(id, { functions: functions.get(id) ?? 0, starts: begun.get(id) ?? 0, callsIn, callsOut })
  }
  return tallies
}
