import type { CallRef, FileStart } from '../../../shared/types'

type Linked = { functions: { exported?: true }[]; starts: FileStart[]; stars: string[]; specs: Set<string>; typed: Set<string>; reexports: Map<string, { spec: string }> }

type Target = (file: string, spec: string) => string | undefined

export type Links = { imports: string[]; typeImports: string[]; reexports: string[] }

const order = (a: CallRef, b: CallRef) => a.file.localeCompare(b.file) || a.fn - b.fn

function starred(parsed: Map<string, Linked>, target: Target): void {
  const api = (file: string, seen: Set<string>): CallRef[] => {
    const at = parsed.get(file)
    if (at === undefined || seen.has(file)) return []
    seen.add(file)
    const own = at.functions.flatMap((fn, i) => (fn.exported === true ? [{ file, fn: i }] : []))
    const named = at.starts.find((start) => start.kind === 'exports')?.calls ?? []
    const deeper = at.stars.flatMap((spec) => {
      const to = target(file, spec)
      return to === undefined ? [] : api(to, seen)
    })
    return [...own, ...named, ...deeper]
  }

  for (const [file, at] of parsed) {
    const into = at.starts.find((start) => start.kind === 'exports')
    if (into === undefined) continue
    for (const ref of api(file, new Set()).filter((ref) => ref.file !== file)) {
      if (!into.calls.some((c) => c.file === ref.file && c.fn === ref.fn)) into.calls.push(ref)
    }
  }

  for (const at of parsed.values()) {
    for (const start of at.starts) start.calls.sort(order)
    at.starts = at.starts.filter((start) => start.calls.length > 0 || start.channel !== undefined)
  }
}

export function linked(parsed: Map<string, Linked>, target: Target): Map<string, Links> {
  starred(parsed, target)
  const resolved = (file: string, specs: Iterable<string>) => [...new Set([...specs].flatMap((spec) => target(file, spec) ?? []))].filter((to) => to !== file).sort()
  return new Map(
    [...parsed].map(([file, at]) => {
      const loaded = resolved(file, at.specs)
      const typed = resolved(file, at.typed)
      const reexports = resolved(file, [...[...at.reexports.values()].map((r) => r.spec), ...at.stars])
      return [file, { imports: [...new Set([...loaded, ...typed])].sort(), typeImports: typed.filter((to) => !loaded.includes(to)), reexports }]
    }),
  )
}
