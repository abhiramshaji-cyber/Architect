import fs from 'node:fs'
import path from 'node:path'
import type { CodeMap, FunctionRow } from '../../shared/types'
import { declaredEntries, edgesOf, factsOf } from './facts'
import { importanceOf } from './importance'
import { sentenceOf } from './sentence'

function manifestOf(root: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

export function functionsOf(map: CodeMap, declared: Set<string>): FunctionRow[] {
  const edges = edgesOf(map)
  const facts = factsOf(map, declared, edges)
  const importance = importanceOf(edges, facts)
  const entries = map.folders.flatMap((folder) => folder.files).flatMap((file) => file.functions)
  return facts.flatMap((fact, at) => {
    const entry = entries[at]
    return entry ? [{ ...fact, importance: importance[at] ?? 1, summary: sentenceOf(entry, fact) }] : []
  })
}

export function listFunctions(root: string, map: CodeMap): FunctionRow[] {
  return functionsOf(map, declaredEntries(manifestOf(root)))
}
