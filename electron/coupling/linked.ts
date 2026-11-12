import type { CodeMap } from '../../shared/types'

export function linker(map: CodeMap): (a: string, b: string) => boolean {
  const files = new Map(map.folders.flatMap((folder) => folder.files).map((file) => [file.path, file]))
  const reach = new Map<string, Set<string>>()

  const reached = (file: string): Set<string> => {
    const known = reach.get(file)
    if (known) return known
    const found = new Set(files.get(file)?.imports ?? [])
    for (const via of found) for (const next of files.get(via)?.reexports ?? []) found.add(next)
    reach.set(file, found)
    return found
  }

  return (a, b) => reached(a).has(b) || reached(b).has(a)
}
