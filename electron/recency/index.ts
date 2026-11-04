import type { Architecture, Change, CodeMap, Recency } from '../../shared/types'
import { changeKey, newer } from '../../shared/recency'
import { ownership } from '../contract/graph'
import type { Lines } from '../git/blame'

export function latestIn(lines: Lines | undefined, from: number, to: number): Change | undefined {
  if (lines === undefined || lines === 'uncommitted') return lines
  return lines.slice(Math.max(0, from - 1), Math.max(0, to)).reduce<Change | undefined>(newer, undefined)
}

export function recencyOf(map: CodeMap, architecture: Architecture | null, blamed: Map<string, Lines>): Recency {
  const files = map.folders.flatMap((folder) => folder.files)
  const functions: Record<string, Change> = {}
  const named = new Map<string, Change | undefined>()

  for (const file of files) {
    for (const entry of file.functions) {
      const change = latestIn(blamed.get(file.path), entry.line, entry.endLine)
      const ref = `${file.path}#${entry.name}`
      named.set(ref, newer(named.get(ref), change))
      if (change) functions[changeKey(file.path, entry.line, entry.name)] = change
    }
  }

  const components: Record<string, Change> = {}
  if (!architecture) return { functions, components }
  const bump = (id: string, change: Change | undefined) => {
    const next = newer(components[id], change)
    if (next) components[id] = next
  }

  // owned
  const paths = files.map((file) => file.path)
  const scoped = architecture.scope ? paths.filter((path) => path.startsWith(`${architecture.scope}/`)) : paths
  const { owned, multi } = ownership(scoped, architecture.components)
  for (const { path, owner } of owned) bump(owner, latestIn(blamed.get(path), 1, Infinity))
  for (const { path, owners } of multi) for (const owner of owners) bump(owner, latestIn(blamed.get(path), 1, Infinity))

  // covered
  for (const component of architecture.components) {
    for (const ref of component.covers ?? []) bump(component.id, named.get(ref))
  }

  return { functions, components }
}
