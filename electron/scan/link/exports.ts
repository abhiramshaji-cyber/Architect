import type { CallRef, FileStart } from '../../../shared/types'

type Linked = { functions: { exported?: true }[]; starts: FileStart[]; stars: string[] }

const order = (a: CallRef, b: CallRef) => a.file.localeCompare(b.file) || a.fn - b.fn

export function starred(parsed: Map<string, Linked>, target: (file: string, spec: string) => string | undefined): void {
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
