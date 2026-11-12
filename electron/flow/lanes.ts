import type { Architecture, CodeMap } from '../../shared/types'
import { check, ownership } from '../contract/graph'

export type Lanes = { of: (file: string) => string; forbidden: (from: string, to: string) => string | undefined }

export const UNOWNED = '(unowned)'

function folderOf(path: string): string {
  const slash = path.indexOf('/')
  return slash > 0 ? path.slice(0, slash) : '.'
}

function ownersOf(map: CodeMap, architecture: Architecture): Map<string, string[]> {
  const files = map.folders.flatMap((folder) => folder.files.map((file) => file.path))
  const scoped = architecture.scope ? files.filter((file) => file.startsWith(`${architecture.scope}/`)) : files
  const { owned, multi } = ownership(scoped, architecture.components)
  const owners = new Map<string, string[]>(owned.map(({ path, owner }) => [path, [owner]]))
  for (const { path, owners: many } of multi) owners.set(path, many)
  return owners
}

export function lanesOf(map: CodeMap, architecture: Architecture | null): Lanes {
  if (!architecture) return { of: folderOf, forbidden: () => undefined }
  const owners = ownersOf(map, architecture)

  const forbidden = (from: string, to: string): string | undefined => {
    for (const a of owners.get(from) ?? []) {
      for (const b of owners.get(to) ?? []) {
        const verdict = a === b ? undefined : check(architecture, a, b)
        if (verdict?.status === 'forbidden') return `${a} → ${b}: ${verdict.reason}`
      }
    }
    return undefined
  }

  return { of: (file) => owners.get(file)?.join(' + ') ?? UNOWNED, forbidden }
}
