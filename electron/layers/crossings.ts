import type { Architecture, CodeMap, FileEntry, LayerCall } from '../../shared/types'
import { ownership } from '../contract/graph'

export type Crossing = { from: string; to: string; call: LayerCall }

function contractOwners(architecture: Architecture, map: CodeMap): (path: string) => string[] {
  const files = map.folders.flatMap((folder) => folder.files.map((file) => file.path))
  const { owned, multi } = ownership(files, architecture.components)
  const owners = new Map<string, string[]>()

  for (const entry of owned) owners.set(entry.path, [entry.owner])
  for (const entry of multi) owners.set(entry.path, entry.owners)

  return (path) => owners.get(path) ?? []
}

export function folderOf(path: string): string {
  const slash = path.indexOf('/')
  return slash > 0 ? path.slice(0, slash) : '.'
}

export function crossings(map: CodeMap, architecture: Architecture | null): Crossing[] {
  const ownersOf = architecture ? contractOwners(architecture, map) : (path: string) => [folderOf(path)]
  const files = new Map<string, FileEntry>(map.folders.flatMap((folder) => folder.files.map((file) => [file.path, file])))
  const found: Crossing[] = []

  for (const file of files.values()) {
    const from = ownersOf(file.path)
    if (from.length === 0) continue

    for (const fn of file.functions) {
      for (const ref of fn.calls) {
        if (ref.file === file.path) continue
        const to = ownersOf(ref.file)
        const target = files.get(ref.file)?.functions[ref.fn]
        const call: LayerCall = {
          file: file.path,
          line: fn.line,
          fn: fn.name,
          target: ref.file,
          targetLine: target?.line ?? 1,
          targetFn: target?.name ?? '',
        }

        for (const a of from) for (const b of to) if (a !== b) found.push({ from: a, to: b, call })
      }
    }
  }

  return found
}
