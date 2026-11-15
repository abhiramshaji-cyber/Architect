import { packageOf } from '../../shared/packages/group'
import { packagesIn } from '../../shared/packages/list'
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

function packageOwners(map: CodeMap): (path: string) => string[] {
  const files = map.folders.flatMap((folder) => folder.files.map((file) => file.path))
  const packages = packagesIn(files)
  const owners = new Map(files.map((file) => [file, [packageOf(file, packages)]]))
  return (path) => owners.get(path) ?? [packageOf(path, packages)]
}

export function ownersOf(map: CodeMap, architecture: Architecture | null): (path: string) => string[] {
  return architecture ? contractOwners(architecture, map) : packageOwners(map)
}

export function crossings(map: CodeMap, architecture: Architecture | null): Crossing[] {
  const ownerOf = ownersOf(map, architecture)
  const files = new Map<string, FileEntry>(map.folders.flatMap((folder) => folder.files.map((file) => [file.path, file])))
  const found: Crossing[] = []

  for (const file of files.values()) {
    const from = ownerOf(file.path)
    if (from.length === 0) continue

    for (const fn of file.functions) {
      for (const ref of fn.calls) {
        if (ref.file === file.path) continue
        const to = ownerOf(ref.file)
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
