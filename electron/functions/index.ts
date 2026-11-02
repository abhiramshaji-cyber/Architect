import fs from 'node:fs'
import path from 'node:path'
import type { CodeMap, FunctionList } from '../../shared/types'
import { declaredEntries, edgesOf, factsOf } from './facts'
import { importanceOf } from './importance'
import { sentenceOf } from './sentence'
import { treeOf } from './tree'

function manifestOf(root: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

export function functionsOf(map: CodeMap, declared: Set<string>): FunctionList {
  const edges = edgesOf(map)
  const facts = factsOf(map, declared, edges)
  const importance = importanceOf(edges, facts)
  const entries = map.folders.flatMap((folder) => folder.files).flatMap((file) => file.functions)
  const rows = facts.flatMap((fact, at) => {
    const entry = entries[at]
    return entry ? [{ ...fact, importance: importance[at] ?? 1, summary: sentenceOf(entry, fact) }] : []
  })
  return { rows, tree: treeOf(rows, edges) }
}

export function listFunctions(root: string, map: CodeMap): FunctionList {
  return functionsOf(map, declaredEntries(manifestOf(root)))
}
