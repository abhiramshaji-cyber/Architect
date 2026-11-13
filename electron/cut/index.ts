import { findCycle } from '../../shared/cycle'
import type { Architecture, CodeMap, LayerCall } from '../../shared/types'
import { crossings } from '../layers/crossings'
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

function without(architecture: Architecture, cut: { from: string; to: string }, from: string, to: string): Architecture {
  const edges = architecture.edges.filter((edge) => !(edge.from === cut.from && edge.to === cut.to))
  return { ...architecture, edges: edges.some((edge) => edge.from === from && edge.to === to) ? edges : [...edges, { from, to }] }
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
  if (drawn.length === 0) return { path, edges: shown, cheapest: null, moves: [], notes: [`${from} -> ${to} makes ${from} depend on itself, so there is no drawn edge to cut`] }

  const least = Math.min(...drawn.map((edge) => edge.calls.length))
  const tied = drawn.filter((edge) => edge.calls.length === least)
  const pick = tied[0] as (typeof drawn)[number]
  const tie = tied.length > 1 ? `${tied.map((edge) => `${edge.from} -> ${edge.to}`).join(', ')} each have ${least} calls; ${pick.from} -> ${pick.to} is picked because it comes first on the cycle after the proposed edge` : null
  const calls = [...pick.calls].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.target.localeCompare(b.target) || a.targetLine - b.targetLine)
  const listed: CutCall[] = calls.slice(0, LISTED).map((call) => ({ caller: named(call.file, call.line, call.fn), site: siteOf(map, call), callee: named(call.target, call.targetLine, call.targetFn) }))

  const callees = [...new Map(calls.map((call) => [`${call.target}:${call.targetLine}`, { file: call.target, line: call.targetLine, name: call.targetFn }])).values()]
  const { moves, more } = movesOf(map, root, without(architecture, pick, from, to), callees)
  const notes = [
    ...(least === 0 ? [`${pick.from} -> ${pick.to} is drawn but no call in the scan crosses it, so removing it from architect.md breaks the cycle without moving code`] : []),
    ...(calls.length > LISTED ? [`${calls.length - LISTED} of ${calls.length} calls are counted but not listed`] : []),
    ...(more > 0 ? [`${more} more called functions would move too; where they could go is not worked out here`] : []),
    `moves say where each called function could go once ${pick.from} -> ${pick.to} is removed and ${from} -> ${to} is drawn, answered by where`,
  ]
  return { path, edges: shown, cheapest: { from: pick.from, to: pick.to, calls: least, tie, listed }, moves, notes }
}

export function cutFor(architecture: Architecture, map: CodeMap, root: string, from: string, to: string): Cut | undefined {
  const path = findCycle(architecture.edges, from, to)
  if (!path) return undefined
  try {
    return cutOf(architecture, map, root, path)
  } catch (err) {
    return { path, edges: [], cheapest: null, moves: [], notes: [`the cheapest edge to cut could not be worked out: ${err instanceof Error ? err.message : String(err)}`] }
  }
}
