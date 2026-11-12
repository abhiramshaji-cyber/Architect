import type { CodeMap, FunctionList, FunctionRow } from '../../shared/types'
import { entryFiles, type EntryFiles } from './entries'
import { edgesOf, factsOf } from './facts'
import { importanceOf } from './importance'
import { foldersOf, scopeOf, subgraphOf, within } from './scope'
import { sentenceOf } from './summary/sentence'
import { treeOf } from './tree'

export function indexOf(map: CodeMap, declared: EntryFiles, scope: string): { rows: FunctionRow[]; calls: number[][] } {
  const edges = edgesOf(map)
  const facts = factsOf(map, declared, edges)
  const entries = map.folders.flatMap((folder) => folder.files).flatMap((file) => file.functions)

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
    const outside = (facts[keep[i] ?? -1]?.fanIn ?? 0) - fact.fanIn
    if (!entry) return []
    const row = {
      ...fact,
      importance: importance[i] ?? 1,
      summary: sentenceOf(entry, fact, outside),
    }
    return [outside > 0 ? { ...row, outside } : row]
  })
  return { rows, calls: sub }
}

export function functionsOf(map: CodeMap, declared: EntryFiles, asked?: unknown): FunctionList {
  const scope = scopeOf(map, asked)
  const { rows, calls } = indexOf(map, declared, scope)
  return {
    rows,
    tree: treeOf(rows, calls, scope !== ''),
    scope,
    folders: foldersOf(map, scope),
  }
}

export { entryFiles, type EntryFiles } from './entries'

export function listFunctions(root: string, map: CodeMap, scope?: unknown): FunctionList {
  return functionsOf(map, entryFiles(root, map), scope)
}
