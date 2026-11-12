import type { CallRef, FileEntry } from '../../shared/types'
import type { Fn } from '../where/refs'
import type { Caller, Entry, Impact } from './schema'

export type Reach = { depth: Map<number, number>; parent: Map<number, number> }

type Start = { file: string; kind: string; calls: number[] }

export const LIST_DEPTH = 3

export const LISTED = 25

const DEPTHS = 25

const at = (fn: Fn) => `${fn.file}:${fn.line}`

const named = (fn: Fn) => `${at(fn)} ${fn.name}`

export function refIndex(fns: Fn[]): (call: CallRef) => number | undefined {
  const offset = new Map<string, number>()
  fns.forEach((fn, i) => offset.has(fn.file) || offset.set(fn.file, i))
  return (call) => {
    const start = offset.get(call.file)
    const index = start === undefined ? undefined : start + call.fn
    return index !== undefined && fns[index]?.file === call.file ? index : undefined
  }
}

function reachOf(edges: number[][], seeds: number[]): Reach {
  const callers = edges.map((): number[] => [])
  edges.forEach((out, from) => out.forEach((to) => callers[to]?.push(from)))
  const depth = new Map<number, number>(seeds.map((seed) => [seed, 0]))
  const parent = new Map<number, number>()
  let frontier = [...new Set(seeds)].sort((a, b) => a - b)

  for (let level = 1; frontier.length > 0; level += 1) {
    const next: number[] = []
    for (const node of frontier) {
      for (const caller of [...(callers[node] ?? [])].sort((a, b) => a - b)) {
        if (depth.has(caller)) continue
        depth.set(caller, level)
        parent.set(caller, node)
        next.push(caller)
      }
    }
    frontier = next.sort((a, b) => a - b)
  }
  return { depth, parent }
}

function startsOf(fns: Fn[], files: FileEntry[]): Start[] {
  const index = refIndex(fns)
  return files.flatMap((file) =>
    (file.starts ?? []).filter((start) => start.kind !== 'exports').map((start) => ({ file: file.path, kind: start.kind, calls: start.calls.flatMap((call) => index(call) ?? []) })),
  )
}

export function callersOf(fns: Fn[], files: FileEntry[], edges: number[][], seeds: number[]) {
  const starts = startsOf(fns, files)
  const reach = reachOf([...edges, ...starts.map((start) => start.calls)], seeds)
  const callee = (node: number) => {
    const fn = fns[reach.parent.get(node) ?? -1]
    return fn ? named(fn) : ''
  }

  const found = [...reach.depth].flatMap(([node, depth]) => {
    const fn = fns[node]
    return fn && !fn.test && depth > 0 ? [{ fn, depth, node }] : []
  })
  found.sort((a, b) => a.depth - b.depth || a.fn.file.localeCompare(b.fn.file) || a.fn.line - b.fn.line)

  const depths: Impact['callers']['depths'] = []
  for (const { fn, depth } of found) {
    const last = depths.at(-1)
    if (last?.depth === depth) last.count += 1
    else depths.push({ depth, count: 1, first: named(fn) })
  }

  const listed = found.filter((hit) => hit.depth <= LIST_DEPTH).slice(0, LISTED).map(({ fn, depth, node }): Caller => ({ name: fn.name, at: at(fn), depth, calls: callee(node) }))
  const entries = starts
    .flatMap((start, i): Entry[] => {
      const depth = reach.depth.get(fns.length + i)
      return depth === undefined ? [] : [{ kind: start.kind, file: start.file, depth, calls: callee(fns.length + i) }]
    })
    .sort((a, b) => a.depth - b.depth || a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind))
  const notes = [
    ...(found.length > listed.length ? [`${found.length - listed.length} of ${found.length} callers are counted in depths but not listed; the list stops at depth ${LIST_DEPTH} or ${LISTED} callers`] : []),
    ...(depths.length > DEPTHS ? [`callers reach depth ${depths.length}; depths past ${DEPTHS} are counted in total but not shown`] : []),
    ...(entries.length > LISTED ? [`${entries.length - LISTED} of ${entries.length} entries are counted but not listed`] : []),
    ...(entries.length > 0 ? ['an entry is code outside any function that calls in (a file loaded at start, an MCP tool, an IPC handler, a CLI command); the scan gives its file, not a line'] : []),
  ]
  return {
    reach,
    callers: { total: found.length, depths: depths.slice(0, DEPTHS), listedThrough: LIST_DEPTH, listed, unlisted: found.length - listed.length },
    entries: { total: entries.length, listed: entries.slice(0, LISTED) },
    reached: entries,
    notes,
  }
}
