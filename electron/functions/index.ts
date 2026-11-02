import fs from 'node:fs'
import path from 'node:path'
import type { CodeMap, FunctionList } from '../../shared/types'
import { declaredEntries, edgesOf, factsOf } from './facts'
import { importanceOf } from './importance'
import { foldersOf, scopeOf, subgraphOf, within } from './scope'
import { sentenceOf } from './summary/sentence'
import { treeOf } from './tree'

function manifestOf(root: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

export function functionsOf(map: CodeMap, declared: Set<string>, asked?: unknown): FunctionList {
  const edges = edgesOf(map)
  const facts = factsOf(map, declared, edges)
  const entries = map.folders.flatMap((folder) => folder.files).flatMap((file) => file.functions)
  const scope = scopeOf(map, asked)

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
  return {
    rows,
    tree: treeOf(rows, sub, scope !== ''),
    scope,
    folders: foldersOf(map, scope),
  }
}

export function listFunctions(root: string, map: CodeMap, scope?: unknown): FunctionList {
  return functionsOf(map, declaredEntries(manifestOf(root)), scope)
}
