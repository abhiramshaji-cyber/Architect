import path from 'node:path'
import type { CloneMatch, SameBehavior } from '../../shared/clones/types'
import type { CodeMap } from '../../shared/types'
import { edgesOf } from '../functions/facts'
import { isTestFile } from '../scan/starts'
import type { Fn, Resolved } from '../where/refs'
import { similarOf } from '../where/similar'
import { LEAST, pairsOf, similarity, type Pair } from './near'
import { shapesOf, type Shape } from './shape'

const found = new WeakMap<CodeMap, { fns: Fn[]; shapes: Shape[]; pairs: Pair[] }>()

function clonesOf(root: string, map: CodeMap) {
  const known = found.get(map)
  if (known) return known
  const fns = map.folders.flatMap((folder) => folder.files.flatMap((file) => file.functions.map((fn) => ({ file: file.path, name: fn.name, line: fn.line, test: isTestFile(file.path) }))))
  const shapes = shapesOf(root, map)
  const pairs = pairsOf(shapes.map((shape, at) => (fns[at]?.test ? { tokens: [], words: new Set<number>() } : shape)))
  const made = { fns, shapes, pairs }
  found.set(map, made)
  return made
}

function structuralOf(fns: Fn[], map: CodeMap, subject: number): Set<number> {
  const edges = edgesOf(map)
  const resolved = (ats: number[]): Resolved[] => ats.map((i) => ({ ref: fns[i]?.name ?? '', status: 'function', files: [fns[i]?.file ?? ''], fns: [i], matches: [] }))
  const callers = edges.flatMap((out, from) => (out.includes(subject) ? [from] : []))
  const marked = fns.map((fn, at) => ({ ...fn, test: fn.test || at === subject }))
  const byPlace = new Map(fns.map((fn, at) => [`${fn.file}:${fn.line}`, at]))
  return new Set(similarOf(marked, edges, resolved(edges[subject] ?? []), resolved(callers)).matches.flatMap((match) => byPlace.get(match.at) ?? []))
}

export function sameBehavior(root: string, map: CodeMap, file: string, symbol: string): SameBehavior {
  const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join('/')
  const { fns, shapes, pairs } = clonesOf(root, map)
  const inFile = fns.flatMap((fn, at) => (fn.file === relative ? [{ ...fn, at }] : []))
  if (inFile.length === 0) return { status: 'unknown', reason: `${relative} has no functions in the scan` }
  const subject = inFile.find((fn) => fn.name === symbol) ?? inFile.find((fn) => fn.name.endsWith(`.${symbol}`))
  if (!subject) return { status: 'unknown', reason: `${relative} has no function named ${symbol}; it has ${inFile.map((fn) => fn.name).join(', ')}` }

  const shape = shapes[subject.at]?.tokens ?? []
  const clones = new Map(pairs.flatMap(({ a, b, similarity: score }) => (a === subject.at ? [[b, score] as const] : b === subject.at ? [[a, score] as const] : [])))
  const structural = structuralOf(fns, map, subject.at)
  const matchOf = (at: number): CloneMatch[] => {
    const fn = fns[at]
    if (!fn) return []
    const score = clones.get(at)
    const clone = score === undefined ? null : score === 1 ? 'exact' : 'near'
    return [{ name: fn.name, file: fn.file, line: fn.line, similarity: score ?? similarity(shape, shapes[at]?.tokens ?? []), clone, structural: structural.has(at) }]
  }
  const matches = [...new Set([...clones.keys(), ...structural])].flatMap(matchOf)
  matches.sort((x, y) => Number(x.clone === null) - Number(y.clone === null) || y.similarity - x.similarity || x.file.localeCompare(y.file) || x.line - y.line)
  return { status: 'done', name: subject.name, file: subject.file, line: subject.line, tokens: shape.length, least: LEAST, matches }
}
