import type { Fn, Resolved } from './refs'

export type Match = { name: string; at: string; callees: string[]; callers: string[] }

export type Similar = { status: 'found' | 'tied' | 'none'; reason: string; matches: Match[] }

const at = (fn: Fn | undefined) => (fn ? `${fn.file}:${fn.line} ${fn.name}` : '')

export function similarOf(fns: Fn[], edges: number[][], calls: Resolved[], callers: Resolved[]): Similar {
  const out = edges.map((targets) => new Set(targets))
  const counted = (ref: Resolved) => ref.status === 'function' || ref.status === 'file'
  const wanted = calls.filter(counted)
  const calling = callers.filter(counted)

  const given = new Set([...wanted, ...calling].flatMap((ref) => ref.fns))

  const scored = fns.flatMap((fn, i): Match[] => {
    if (fn.test || given.has(i)) return []
    const callees = wanted.flatMap((ref) => {
      const hit = ref.fns.find((target) => out[i]?.has(target))
      return hit === undefined ? [] : [`${ref.ref} at ${at(fns[hit])}`]
    })
    const shared = calling.flatMap((ref) => {
      const hit = ref.fns.find((source) => source !== i && out[source]?.has(i))
      return hit === undefined ? [] : [`${ref.ref} at ${at(fns[hit])}`]
    })
    return callees.length + shared.length === 0 ? [] : [{ name: fn.name, at: `${fn.file}:${fn.line}`, callees, callers: shared }]
  })

  scored.sort((a, b) => b.callees.length - a.callees.length || b.callers.length - a.callers.length || a.at.localeCompare(b.at))
  const best = scored[0]
  if (!best) return { status: 'none', reason: 'no function in the scan calls any of the calls or is called by any of the callers', matches: [] }

  const matches = scored.filter((match) => match.callees.length === best.callees.length && match.callers.length === best.callers.length)
  const share = `${best.callees.length} of ${wanted.length} callees and ${best.callers.length} of ${calling.length} callers`
  if (matches.length > 1) return { status: 'tied', reason: `${matches.length} functions each share ${share}`, matches }
  return { status: 'found', reason: `${best.name} shares ${share}`, matches }
}
