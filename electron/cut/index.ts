import { findCycle } from '../../shared/cycle'
import type { Architecture, CodeMap, LayerCall } from '../../shared/types'
import { crossings, type Crossing } from '../layers/crossings'
import { movesOf } from './moves'
import type { Cut, CutCall } from './schema'

export { cutSchema, type Cut } from './schema'

const LISTED = 20

const named = (file: string, line: number, name: string) => `${file}:${line} ${name}`

function siteOf(map: CodeMap, call: LayerCall): string {
  const files = map.folders.flatMap((folder) => folder.files)
  const caller = files.find((file) => file.path === call.file)?.functions.find((fn) => fn.line === call.line && fn.name === call.fn)
  const target = files.find((file) => file.path === call.target)?.functions.findIndex((fn) => fn.line === call.targetLine && fn.name === call.targetFn) ?? -1
  const site = (caller?.sites ?? []).find((one) => 'file' in one && one.file === call.target && one.fn === target)
  return `${call.file}:${site?.line ?? call.line}`
}

function without(architecture: Architecture, cuts: { from: string; to: string }[], from: string, to: string): Architecture {
  const edges = architecture.edges.filter((edge) => !cuts.some((cut) => edge.from === cut.from && edge.to === cut.to))
  return { ...architecture, edges: edges.some((edge) => edge.from === from && edge.to === to) ? edges : [...edges, { from, to }] }
}

function alsoOf(architecture: Architecture, all: Crossing[], pick: { from: string; to: string }, from: string, to: string): { from: string; to: string; calls: number }[] {
  const cuts = [pick]
  const also: { from: string; to: string; calls: number }[] = []
  for (let path = findCycle(without(architecture, cuts, from, to).edges.filter((edge) => !(edge.from === from && edge.to === to)), from, to); path; path = findCycle(without(architecture, cuts, from, to).edges.filter((edge) => !(edge.from === from && edge.to === to)), from, to)) {
    const costed = path.slice(2).map((next, i) => ({ from: path[i + 1] ?? '', to: next, calls: all.filter((one) => one.from === path[i + 1] && one.to === next).length }))
    const next = costed.reduce((best, edge) => (edge.calls < best.calls ? edge : best), costed[0] as (typeof costed)[number])
    cuts.push(next)
    also.push(next)
  }
  return also
}

export function cutOf(architecture: Architecture, map: CodeMap, root: string, path: string[]): Cut {
  const [from, to] = [path[0] ?? '', path[1] ?? '']
  const all = crossings(map, architecture)
  const pairs = path.slice(1).map((next, i) => ({ from: path[i] ?? '', to: next }))
  const edges = pairs.map((edge, i) => {
    const calls = all.filter((one) => one.from === edge.from && one.to === edge.to).map((one) => one.call)
    return { ...edge, calls, proposed: i === 0 }
  })
  const shown = edges.map(({ from: a, to: b, calls, proposed }) => ({ from: a, to: b, calls: calls.length, proposed }))
  const drawn = edges.filter((edge) => !edge.proposed)
  if (drawn.length === 0) return { path, edges: shown, cheapest: null, also: [], moves: [], notes: [`${from} -> ${to} makes ${from} depend on itself, so there is no drawn edge to cut`] }

  const least = Math.min(...drawn.map((edge) => edge.calls.length))
  const tied = drawn.filter((edge) => edge.calls.length === least)
  const pick = tied[0] as (typeof drawn)[number]
  const tie = tied.length > 1 ? `${tied.map((edge) => `${edge.from} -> ${edge.to}`).join(', ')} each have ${least} calls; ${pick.from} -> ${pick.to} is picked because it comes first on the cycle after the proposed edge` : null
  const calls = [...pick.calls].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.target.localeCompare(b.target) || a.targetLine - b.targetLine)
  const listed: CutCall[] = calls.slice(0, LISTED).map((call) => ({ caller: named(call.file, call.line, call.fn), site: siteOf(map, call), callee: named(call.target, call.targetLine, call.targetFn) }))

  const callees = [...new Map(calls.map((call) => [`${call.target}:${call.targetLine}`, { file: call.target, line: call.targetLine, name: call.targetFn }])).values()]
  const also = alsoOf(architecture, all, pick, from, to)
  const { moves, more } = movesOf(map, root, without(architecture, [pick, ...also], from, to), callees)
  const notes = [
    ...(also.length > 0 ? [`cutting ${pick.from} -> ${pick.to} alone leaves another path from ${to} back to ${from}; also listed are the cheapest edges on each path left, cut together`] : []),
    ...(least === 0 ? [`${pick.from} -> ${pick.to} is drawn but no call between functions crosses it (calls from top level code and imports of values or types are not counted), so it may be removable from architect.md without moving code`] : []),
    ...(calls.length > LISTED ? [`${calls.length - LISTED} of ${calls.length} calls are counted but not listed`] : []),
    ...(more > 0 ? [`${more} more called functions would move too; where they could go is not worked out here`] : []),
    `moves say where each called function could go once ${pick.from} -> ${pick.to} is removed and ${from} -> ${to} is drawn, answered by where`,
  ]
  return { path, edges: shown, cheapest: { from: pick.from, to: pick.to, calls: least, tie, listed }, also: also.map(({ from: a, to: b, calls: n }) => ({ from: a, to: b, calls: n })), moves, notes }
}

const TIMEOUT_MS = 5000

export async function cutFor(architecture: Architecture, load: () => Promise<CodeMap>, root: string, from: string, to: string, timeoutMs = TIMEOUT_MS): Promise<Cut | undefined> {
  const path = findCycle(architecture.edges, from, to)
  if (!path) return undefined
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
