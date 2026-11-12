import type { Architecture, CodeMap, LayerCell, Layers, LayerStatus, Verdict } from '../../shared/types'
import { check } from '../contract/graph'
import { crossings, folderOf, ownersOf } from './crossings'
import { levelize } from './level'

function importPairs(architecture: Architecture, map: CodeMap): Set<string> {
  const ownerOf = ownersOf(map, architecture)
  const pairs = new Set<string>()
  for (const file of map.folders.flatMap((folder) => folder.files)) {
    for (const target of file.imports ?? []) {
      for (const a of ownerOf(file.path)) for (const b of ownerOf(target)) if (a !== b) pairs.add(`${a}\n${b}`)
    }
  }
  return pairs
}

function statusOf(verdict: Verdict, calls: number, drawn: boolean, imported: boolean): LayerStatus | null {
  if (calls === 0 && !drawn) return null
  if (calls === 0 && !imported) return 'stale'
  if (verdict.status === 'allowed' || verdict.status === 'forbidden') return verdict.status
  return 'undrawn'
}

function contractCells(architecture: Architecture, map: CodeMap, grouped: Map<string, LayerCell>): LayerCell[] {
  const ids = new Set(architecture.components.map((c) => c.id))
  const drawn = new Set(architecture.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to).map((e) => `${e.from}\n${e.to}`))
  const imported = importPairs(architecture, map)
  const keys = [...new Set([...grouped.keys(), ...drawn])]

  return keys.flatMap((key) => {
    const [from, to] = key.split('\n') as [string, string]
    const cell = grouped.get(key) ?? { from, to, status: 'stale', calls: [] }
    const verdict = check(architecture, from, to)
    const status = statusOf(verdict, cell.calls.length, drawn.has(key), imported.has(key))
    return status ? [{ ...cell, status, verdict }] : []
  })
}

export function layersOf(architecture: Architecture | null, map: CodeMap): Layers {
  const grouped = new Map<string, LayerCell>()

  for (const { from, to, call } of crossings(map, architecture)) {
    const key = `${from}\n${to}`
    const cell = grouped.get(key) ?? { from, to, status: 'free', calls: [] }
    cell.calls.push(call)
    grouped.set(key, cell)
  }

  const cells = architecture ? contractCells(architecture, map, grouped) : [...grouped.values()]
  const ids = architecture
    ? architecture.components.map((c) => c.id)
    : [...new Set(map.folders.flatMap((folder) => folder.files.map((file) => folderOf(file.path))))]
  const live = cells.filter((cell) => cell.calls.length > 0).map(({ from, to }) => ({ from, to }))

  return { contract: architecture !== null, rows: levelize(ids, live), cells }
}
