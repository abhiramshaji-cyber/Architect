import path from 'node:path'
import type { CodeMap, ScopeFolder } from '../../shared/types'

export function normalScope(root: string, scope: unknown): string | null {
  if (typeof scope !== 'string') return ''
  const trimmed = scope.trim()
  const relative = path.isAbsolute(trimmed) ? path.relative(root, trimmed) : trimmed
  if (path.isAbsolute(relative)) return null
  const clean = path.posix.normalize(relative === '' ? '.' : relative).replace(/\/+$/, '')
  if (clean === '..' || clean.startsWith('../')) return null
  return clean === '.' ? '' : clean
}

export function scopeOf(map: CodeMap, scope: unknown): string {
  const clean = normalScope(map.root, scope)?.normalize('NFC')
  if (!clean) return ''
  return map.folders.find((folder) => folder.path.normalize('NFC') === clean)?.path ?? ''
}

export function within(file: string, scope: string): boolean {
  return scope === '' || file.startsWith(`${scope}/`)
}

export function foldersOf(map: CodeMap, scope: string): ScopeFolder[] {
  const counts = new Map<string, number>()
  for (const file of map.folders.flatMap((folder) => folder.files)) {
    if (file.functions.length === 0 || !within(file.path, scope)) continue
    for (let at = file.path.lastIndexOf('/'); at > scope.length; at = file.path.lastIndexOf('/', at - 1)) {
      const folder = file.path.slice(0, at)
      counts.set(folder, (counts.get(folder) ?? 0) + file.functions.length)
    }
  }
  return [...counts]
    .map(([folder, functions]) => ({ path: folder, functions }))
    .sort((a, b) => b.functions - a.functions || a.path.localeCompare(b.path))
}

export function subgraphOf(edges: number[][], keep: number[]): number[][] {
  const local = new Map(keep.map((at, i) => [at, i]))
  return keep.map((at) =>
    (edges[at] ?? []).flatMap((to) => {
      const i = local.get(to)
      return i === undefined ? [] : [i]
    }),
  )
}
