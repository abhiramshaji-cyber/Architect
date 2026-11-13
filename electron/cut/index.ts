import { findCycle } from '../../shared/cycle'
import type { Architecture, CodeMap, LayerCall } from '../../shared/types'
import { crossings } from '../layers/crossings'
import { movesOf } from './moves'
import type { Cut, CutCall } from './schema'

export { cutSchema, type Cut } from './schema'

const LISTED = 20

const ALSO_LISTED = 5

const named = (file: string, line: number, name: string) => `${file}:${line} ${name}`

function siteOf(map: CodeMap, call: LayerCall): string | null {
  const files = map.folders.flatMap((folder) => folder.files)
  const caller = files.find((file) => file.path === call.file)?.functions.find((fn) => fn.line === call.line && fn.name === call.fn)
  const target = files.find((file) => file.path === call.target)?.functions.findIndex((fn) => fn.line === call.targetLine && fn.name === call.targetFn) ?? -1
  const site = (caller?.sites ?? []).find((one) => 'file' in one && one.file === call.target && one.fn === target)
  return site ? `${call.file}:${site.line}` : null
}

type Pair = { from: string; to: string }

const same = (a: Pair, b: Pair) => a.from === b.from && a.to === b.to

function drawnWithout(architecture: Architecture, cuts: Pair[]): Architecture['edges'] {
  return architecture.edges.filter((edge) => !cuts.some((cut) => same(edge, cut)))
}

function greedyFrom(architecture: Architecture, cost: (edge: Pair) => number, pick: Pair, from: string, to: string): Pair[] {
  const cuts = [pick]
  for (let path = findCycle(drawnWithout(architecture, cuts), from, to); path; path = findCycle(drawnWithout(architecture, cuts), from, to)) {
    const costed = path.slice(2).map((next, i) => ({ from: path[i + 1] ?? '', to: next }))
    cuts.push(costed.reduce((best, edge) => (cost(edge) < cost(best) ? edge : best), costed[0] as Pair))
  }
  return cuts.slice(1)
}

function listOf(map: CodeMap, calls: LayerCall[], limit: number): CutCall[] {
  return [...calls]
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.target.localeCompare(b.target) || a.targetLine - b.targetLine)
    .slice(0, limit)
    .map((call) => ({ caller: named(call.file, call.line, call.fn), site: siteOf(map, call), callee: named(call.target, call.targetLine, call.targetFn) }))
}

export function cutOf(architecture: Architecture, map: CodeMap, root: string, path: string[]): Cut {
  const [from, to] = [path[0] ?? '', path[1] ?? '']
  const all = crossings(map, architecture)
  const byEdge = new Map<string, LayerCall[]>()
  for (const one of all) byEdge.set(`${one.from}\0${one.to}`, [...(byEdge.get(`${one.from}\0${one.to}`) ?? []), one.call])
  const callsOf = (edge: Pair) => byEdge.get(`${edge.from}\0${edge.to}`) ?? []
  const cost = (edge: Pair) => callsOf(edge).length
  const edges = path.slice(1).map((next, i) => ({ from: path[i] ?? '', to: next, calls: cost({ from: path[i] ?? '', to: next }), proposed: i === 0 }))
  const drawn = edges.filter((edge) => !edge.proposed)
  if (drawn.length === 0) return { path, edges, cheapest: null, also: [], moves: [], notes: [`${from} -> ${to} makes ${from} depend on itself, so there is no drawn edge to cut`] }

  const least = Math.min(...drawn.map((edge) => edge.calls))
  const tied = drawn.filter((edge) => edge.calls === least)
  let pick: Pair = tied[0] as Pair
  let also = greedyFrom(architecture, cost, pick, from, to)
  let tie = tied.length > 1 ? `${tied.map((edge) => `${edge.from} -> ${edge.to}`).join(', ')} each have ${least} calls; ${pick.from} -> ${pick.to} is picked because it comes first on the cycle after the proposed edge` : null
  const total = (cuts: Pair[]) => cuts.reduce((sum, edge) => sum + cost(edge), 0)
  const single = also.length === 0 ? [] : architecture.edges.filter((edge) => !findCycle(drawnWithout(architecture, [edge]), from, to)).sort((a, b) => cost(a) - cost(b) || `${a.from} -> ${a.to}`.localeCompare(`${b.from} -> ${b.to}`))
  let alone: string | null = null
  if (single[0] && cost(single[0]) <= total([pick, ...also])) {
    pick = single[0]
    also = []
    tie = null
    alone = `cutting ${pick.from} -> ${pick.to} alone breaks every path for ${cost(pick)} calls, no more than cutting one edge on each path; ties between single edges go to the first by name`
  }
  const kept = [pick, ...also]
  for (const edge of [...kept].sort((a, b) => cost(b) - cost(a))) {
    const rest = kept.filter((other) => other !== edge)
    if (rest.length > 0 && !findCycle(drawnWithout(architecture, rest), from, to)) kept.splice(kept.indexOf(edge), 1)
  }
  if (!kept.includes(pick)) tie = null
  ;[pick, ...also] = [kept[0] as Pair, ...kept.slice(1)]

  const calls = callsOf(pick)
  const callees = [...new Map(calls.map((call) => [`${call.target}:${call.targetLine}`, { file: call.target, line: call.targetLine, name: call.targetFn }])).values()]
  const { moves, more } = movesOf(map, root, { ...architecture, edges: [...drawnWithout(architecture, [pick, ...also]), { from, to }] }, callees)
  const notes = [
    ...(alone ? [alone] : []),
    ...(also.length > 0 ? [`cutting ${pick.from} -> ${pick.to} alone leaves another path from ${to} back to ${from}; also lists the cheapest edge on each path left, to cut together`] : []),
    ...(cost(pick) === 0 ? [`${pick.from} -> ${pick.to} is drawn but no call between functions crosses it (calls from top level code and imports of values or types are not counted), so it may be removable from architect.md without moving code`] : []),
    ...(calls.length > LISTED ? [`${calls.length - LISTED} of ${calls.length} calls are counted but not listed`] : []),
    ...(more > 0 ? [`${more} more called functions would move too; where they could go is not worked out here`] : []),
    ...(moves.length > 0 ? [`moves say where each called function could go once the cut edges are removed and ${from} -> ${to} is drawn, answered by where`] : []),
  ]
  return { path, edges, cheapest: { from: pick.from, to: pick.to, calls: cost(pick), tie, listed: listOf(map, calls, LISTED) }, also: also.map((edge) => ({ from: edge.from, to: edge.to, calls: cost(edge), listed: listOf(map, callsOf(edge), ALSO_LISTED) })), moves, notes }
}

const TIMEOUT_MS = 5000

export async function cutFor(architecture: Architecture, load: () => Promise<CodeMap>, root: string, from: string, to: string, timeoutMs = TIMEOUT_MS): Promise<Cut | undefined> {
  const path = findCycle(architecture.edges, from, to)
  if (!path) return undefined
  if (path.length === 2) return cutOf(architecture, { root, scannedAt: 0, folders: [] }, root, path)
  const failed = (note: string): Cut => ({ path, edges: [], cheapest: null, also: [], moves: [], notes: [note] })
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(resolve, timeoutMs, null)
  })
  try {
    const map = await Promise.race([load(), late])
    return map === null ? failed(`the cheapest edge to cut was not worked out: reading the scan took longer than ${timeoutMs} ms`) : cutOf(architecture, map, root, path)
  } catch (err) {
    return failed(`the cheapest edge to cut could not be worked out: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
  }
}
