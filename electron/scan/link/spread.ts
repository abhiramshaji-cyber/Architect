import type { CallRef } from '../../../shared/types'

type Linked = {
  topLevel: Map<string, number>
  exports: Map<string, string>
  reexports: Map<string, { spec: string; name: string }>
  stars: string[]
}

type Target = (file: string, spec: string) => string | undefined

export function spreadOf(parsed: Map<string, Linked>, target: Target) {
  const spread = (file: string, key: string, seen: Set<string>): CallRef[] => {
    const at = parsed.get(file)
    const mark = `${file}\0${key}`
    if (at === undefined || seen.has(mark)) return []
    seen.add(mark)
    const under = (local: string) =>
      [...at.topLevel].flatMap(([name, fn]) => (name === local || name.startsWith(`${local}.`) ? [{ file, fn }] : []))
    const via = (spec: string, next: string) => {
      const to = target(file, spec)
      return to === undefined ? [] : spread(to, next, seen)
    }

    if (key === '') {
      return [
        ...[...at.exports.values()].flatMap(under),
        ...[...at.reexports.values()].flatMap((forward) => via(forward.spec, forward.name === '*' ? '' : forward.name)),
        ...at.stars.flatMap((spec) => via(spec, '')),
      ]
    }

    for (let cut = key.length; cut > 0; cut = key.lastIndexOf('.', cut - 1)) {
      const prefix = key.slice(0, cut)
      const rest = key.slice(cut)
      const local = at.exports.get(prefix)
      const own = local === undefined ? [] : under(local + rest)
      if (own.length > 0) return own
      const forward = at.reexports.get(prefix)
      const passed = forward === undefined ? [] : via(forward.spec, forward.name === '*' ? rest.slice(1) : forward.name + rest)
      if (passed.length > 0) return passed
    }
    return at.stars.flatMap((spec) => via(spec, key))
  }
  return (file: string, key: string) => spread(file, key, new Set())
}
