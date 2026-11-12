import fs from 'node:fs'
import path from 'node:path'
import type { CodeMap, FunctionList, FunctionRow } from '../../shared/types'
import { declaredEntries, edgesOf, factsOf } from './facts'
import { importanceOf } from './importance'
import { foldersOf, scopeOf, subgraphOf, within } from './scope'
import { treeOf } from './tree'

function manifestOf(root: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

export function indexOf(map: CodeMap, declared: Set<string>, scope: string): { rows: FunctionRow[]; calls: number[][] } {
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
    const row: FunctionRow = {
      ...fact,
      importance: importance[i] ?? 1,
    }
    if (entry.signature !== undefined) row.signature = entry.signature
    if (entry.doc !== undefined) row.doc = entry.doc
    if (outside > 0) row.outside = outside
    return [row]
  })
  return { rows, calls: sub }
}

export function functionsOf(map: CodeMap, declared: Set<string>, asked?: unknown): FunctionList {
  const scope = scopeOf(map, asked)
  const { rows, calls } = indexOf(map, declared, scope)
  return {
    rows,
    calls,
    tree: treeOf(rows, calls, scope !== ''),
    scope,
    folders: foldersOf(map, scope),
  }
}

export function manifestEntries(root: string): Set<string> {
  return declaredEntries(manifestOf(root))
}

export function listFunctions(root: string, map: CodeMap, scope?: unknown): FunctionList {
  return functionsOf(map, manifestEntries(root), scope)
}
