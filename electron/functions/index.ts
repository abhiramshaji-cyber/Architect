import type { Architecture, CodeMap, FunctionList, FunctionRow } from '../../shared/types'
import { ownership } from '../contract/graph'
import { splitsIn } from '../rules/split'
import { entryFiles, type EntryFiles } from './entries'
import { edgesOf, factsOf } from './facts'
import { importanceOf } from './importance'
import { foldersOf, scopeOf, subgraphOf, within } from './scope'
import { treeOf } from './tree'

function selfCallsOf(map: CodeMap): boolean[] {
  return map.folders
    .flatMap((folder) => folder.files)
    .flatMap((file) => file.functions.map((fn, at) => fn.calls.some((call) => call.file === file.path && call.fn === at)))
}

export function indexOf(map: CodeMap, declared: EntryFiles, scope: string): { rows: FunctionRow[]; calls: number[][] } {
  const edges = edgesOf(map)
  const facts = factsOf(map, declared, edges)
  const entries = map.folders.flatMap((folder) => folder.files).flatMap((file) => file.functions)
  const recursive = selfCallsOf(map)

  const keep = facts.flatMap((fact, at) => (within(fact.file, scope) ? [at] : []))
  const sub = scope === '' ? edges : subgraphOf(edges, keep)
  const callers = new Array<number>(sub.length).fill(0)
  for (const out of sub) for (const to of out) callers[to] = (callers[to] ?? 0) + 1
  const local = keep.flatMap((at, i) => {
    const fact = facts[at]
    return fact ? [{ ...fact, fanIn: callers[i] ?? 0, fanOut: sub[i]?.length ?? 0 }] : []
  })

  const importance = importanceOf(sub, local)
  const rows = local.flatMap((fact, i) => {
    const entry = entries[keep[i] ?? -1]
    const whole = facts[keep[i] ?? -1]
    if (!entry || !whole) return []
    const row: FunctionRow = {
      ...fact,
      importance: importance[i] ?? 1,
    }
    if (entry.signature !== undefined) row.signature = entry.signature
    if (entry.doc !== undefined) row.doc = entry.doc
    if (recursive[keep[i] ?? -1]) row.recursive = true
    if (whole.fanIn > fact.fanIn) row.outsideCallers = whole.fanIn - fact.fanIn
    if (whole.fanOut > fact.fanOut) row.outsideCallees = whole.fanOut - fact.fanOut
    return [row]
  })
  return { rows, calls: sub }
}

function ownersOf(map: CodeMap, scope: string, architecture: Architecture | null): Record<string, string> {
  if (!architecture) return {}
  const files = map.folders.flatMap((folder) => folder.files.map((file) => file.path)).filter((file) => within(file, scope))
  const scoped = architecture.scope ? files.filter((file) => file.startsWith(`${architecture.scope}/`)) : files
  const { owned, multi } = ownership(scoped, architecture.components)
  return Object.fromEntries([
    ...owned.map(({ path, owner }) => [path, owner]),
    ...multi.map(({ path, owners }) => [path, owners.join(' + ')]),
  ])
}

export function functionsOf(
  map: CodeMap,
  declared: EntryFiles,
  asked?: unknown,
  architecture: Architecture | null = null,
): FunctionList {
  const scope = scopeOf(map, asked)
  const { rows, calls } = indexOf(map, declared, scope)
  return {
    rows,
    calls,
    tree: treeOf(rows, calls, scope !== ''),
    scope,
    folders: foldersOf(map, scope),
    owners: ownersOf(map, scope, architecture),
  }
}

export { entryFiles, type EntryFiles } from './entries'

export function listFunctions(
  root: string,
  map: CodeMap,
  scope?: unknown,
  architecture: Architecture | null = null,
): FunctionList {
  return { ...functionsOf(map, entryFiles(root, map), scope, architecture), splits: splitsIn(root, map, architecture) }
}
